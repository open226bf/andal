import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { canManageAccount, canManageAccounts } from '@andal/authz';
import {
  linkTokenHash,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  recoveryCodeHash,
  tr,
  verifyTotp,
  type Database,
  type User,
} from '@andal/db';
import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import QRCode from 'qrcode';
import { AuditService } from '../audit.service.js';
import { config } from '../env.js';
import { DB, VALKEY } from '../infra.module.js';
import { MailService } from '../mail.service.js';
import { LoginThrottleService } from './login-throttle.service.js';

export const MFA_COOKIE = 'andal_mfa';
/** Le temps de sortir son téléphone. */
const CHALLENGE_TTL_SECONDS = 300;
/** Essais par étape: au-delà, il faut redonner le mot de passe. */
const CHALLENGE_TRIES = 5;
const SETUP_TTL_SECONDS = 900;

interface Challenge {
  userId: string;
  tries: number;
}

/**
 * Double authentification des comptes à mot de passe: une application
 * d'authentification (TOTP) et dix codes de secours à usage unique. Le SSO
 * laisse ce rôle au fournisseur d'identité.
 */
@Injectable()
export class MfaService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly audit: AuditService,
    private readonly throttle: LoginThrottleService,
    private readonly mail: MailService,
  ) {}

  enabledFor(user: User): boolean {
    return user.totp_enabled_at !== null && user.totp_secret !== null;
  }

  async status(user: User) {
    const left = this.enabledFor(user)
      ? Number((await this.db.selectFrom('recovery_codes').select((eb) => eb.fn.countAll<string>().as('n')).where('user_id', '=', user.id).where('used_at', 'is', null).executeTakeFirstOrThrow()).n)
      : 0;
    return { enabled: this.enabledFor(user), enabledAt: user.totp_enabled_at?.toISOString() ?? null, recoveryCodesLeft: left, available: user.password_hash !== null };
  }

  /**
   * Vérifie un code de l'application (6 chiffres) ou un code de secours, et le
   * consomme: un code ne sert qu'une fois. Renvoie ce qui a servi, ou null.
   */
  private async consume(user: User, raw: unknown): Promise<'totp' | 'recovery' | null> {
    if (typeof raw !== 'string' || raw.length > 40 || !user.totp_secret) return null;
    const code = raw.trim();
    if (/^\d[\d\s]{5,7}$/.test(code)) {
      const step = verifyTotp(user.totp_secret, code, user.totp_last_step === null ? null : Number(user.totp_last_step));
      if (step === null) return null;
      // Condition sur l'ancien pas: deux requêtes simultanées ne passent pas toutes les deux.
      const updated = await this.db
        .updateTable('users')
        .set({ totp_last_step: step })
        .where('id', '=', user.id)
        .where((eb) => eb.or([eb('totp_last_step', 'is', null), eb('totp_last_step', '<', String(step))]))
        .returning('id')
        .executeTakeFirst();
      return updated ? 'totp' : null;
    }
    const recovery = normalizeRecoveryCode(code);
    if (!recovery) return null;
    const used = await this.db
      .updateTable('recovery_codes')
      .set({ used_at: new Date() })
      .where('user_id', '=', user.id)
      .where('code_hash', '=', recoveryCodeHash(recovery))
      .where('used_at', 'is', null)
      .returning('user_id')
      .executeTakeFirst();
    return used ? 'recovery' : null;
  }

  /** Code exigé pour un changement sensible (désactiver, nouveaux codes), avec le même frein qu'à la connexion. */
  private async require(user: User, code: unknown, req: FastifyRequest, reply: FastifyReply): Promise<'totp' | 'recovery'> {
    const account = `mfa:${user.id}`;
    await this.throttle.guard(account, req.ip, reply);
    const used = await this.consume(user, code);
    if (!used) {
      await this.throttle.failed(account, req.ip);
      throw new ForbiddenException('Code incorrect ou déjà utilisé.');
    }
    await this.throttle.succeeded(account);
    return used;
  }

  /* ---------- Connexion en deux étapes ---------- */

  private challengeKey(id: string): string {
    return `andal:mfa:${linkTokenHash(id)}`;
  }

  /** Mot de passe juste, compte protégé: on attend le code, sans ouvrir de session. */
  async challenge(user: User, reply: FastifyReply): Promise<void> {
    const id = randomBytes(32).toString('base64url');
    await this.valkey.set(this.challengeKey(id), JSON.stringify({ userId: user.id, tries: 0 } satisfies Challenge), 'EX', CHALLENGE_TTL_SECONDS);
    reply.setCookie(MFA_COOKIE, id, { path: '/api/auth', httpOnly: true, sameSite: 'strict', secure: config.secureCookies, maxAge: CHALLENGE_TTL_SECONDS });
  }

  /** Deuxième étape: le compte, si le code est bon. L'étape est à usage unique. */
  async complete(req: FastifyRequest, reply: FastifyReply, code: unknown): Promise<{ user: User; used: 'totp' | 'recovery' }> {
    const id = req.cookies[MFA_COOKIE];
    const key = id ? this.challengeKey(id) : null;
    const raw = key ? await this.valkey.get(key) : null;
    if (!key || !raw) throw new UnauthorizedException('Étape expirée: reconnectez-vous avec votre mot de passe.');
    const challenge = JSON.parse(raw) as Challenge;
    const user = await this.db.selectFrom('users').selectAll().where('id', '=', challenge.userId).executeTakeFirst();
    if (!user || user.disabled_at || !this.enabledFor(user)) {
      await this.valkey.del(key);
      throw new UnauthorizedException('Étape expirée: reconnectez-vous avec votre mot de passe.');
    }
    const account = `mfa:${user.id}`;
    await this.throttle.guard(account, req.ip, reply);
    const used = await this.consume(user, code);
    if (!used) {
      await this.throttle.failed(account, req.ip);
      challenge.tries += 1;
      if (challenge.tries >= CHALLENGE_TRIES) {
        await this.valkey.del(key);
        reply.clearCookie(MFA_COOKIE, { path: '/api/auth' });
        throw new UnauthorizedException('Trop de codes incorrects: reconnectez-vous avec votre mot de passe.');
      }
      await this.valkey.set(key, JSON.stringify(challenge), 'KEEPTTL');
      await this.audit.record({ workspaceId: user.workspace_id, actorId: null, action: 'auth.mfa_failed', targetType: 'user', targetId: user.id, ip: req.ip });
      throw new HttpException('Code incorrect ou déjà utilisé.', HttpStatus.UNAUTHORIZED);
    }
    await this.valkey.del(key);
    reply.clearCookie(MFA_COOKIE, { path: '/api/auth' });
    await this.throttle.succeeded(account);
    if (used === 'recovery') await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.recovery_code_used', targetType: 'user', targetId: user.id, ip: req.ip });
    return { user, used };
  }

  /* ---------- Activation, désactivation ---------- */

  private setupKey(userId: string): string {
    return `andal:totp-setup:${userId}`;
  }

  private assertPasswordAccount(user: User) {
    if (!user.password_hash) throw new ForbiddenException('Ce compte se connecte par SSO: la double authentification se règle chez votre fournisseur d’identité.');
  }

  /** Un nouveau secret, gardé de côté le temps de le scanner; rien ne change tant qu'un code n'est pas confirmé. */
  async setup(user: User) {
    this.assertPasswordAccount(user);
    if (this.enabledFor(user)) throw new ConflictException('La double authentification est déjà active.');
    const secret = newTotpSecret();
    await this.valkey.set(this.setupKey(user.id), secret, 'EX', SETUP_TTL_SECONDS);
    const uri = otpauthUri(secret, user.email);
    const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#161B26', light: '#FFFFFF' } });
    return { secret, uri, qr };
  }

  /** Confirme avec un premier code: la protection s'active, et les codes de secours s'affichent une seule fois. */
  async enable(user: User, code: unknown, ip: string): Promise<{ recoveryCodes: string[] }> {
    this.assertPasswordAccount(user);
    if (this.enabledFor(user)) throw new ConflictException('La double authentification est déjà active.');
    const secret = await this.valkey.get(this.setupKey(user.id));
    if (!secret) throw new BadRequestException('Le QR code a expiré: recommencez.');
    const step = typeof code === 'string' ? verifyTotp(secret, code, null) : null;
    if (step === null) throw new BadRequestException('Code incorrect: vérifiez l’heure du téléphone, puis tapez le code affiché.');
    const codes = newRecoveryCodes();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ totp_secret: secret, totp_enabled_at: new Date(), totp_last_step: step }).where('id', '=', user.id).execute();
      await trx.deleteFrom('recovery_codes').where('user_id', '=', user.id).execute();
      await trx.insertInto('recovery_codes').values(codes.map((c) => ({ user_id: user.id, code_hash: recoveryCodeHash(c) }))).execute();
    });
    await this.valkey.del(this.setupKey(user.id));
    await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.mfa_enabled', targetType: 'user', targetId: user.id, ip });
    return { recoveryCodes: codes };
  }

  async disable(user: User, code: unknown, req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!this.enabledFor(user)) return;
    await this.require(user, code, req, reply);
    await this.clear(user.id);
    await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.mfa_disabled', targetType: 'user', targetId: user.id, ip: req.ip });
  }

  async regenerate(user: User, code: unknown, req: FastifyRequest, reply: FastifyReply): Promise<{ recoveryCodes: string[] }> {
    if (!this.enabledFor(user)) throw new ConflictException('La double authentification n’est pas active.');
    await this.require(user, code, req, reply);
    const codes = newRecoveryCodes();
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('recovery_codes').where('user_id', '=', user.id).execute();
      await trx.insertInto('recovery_codes').values(codes.map((c) => ({ user_id: user.id, code_hash: recoveryCodeHash(c) }))).execute();
    });
    await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.recovery_codes_regenerated', targetType: 'user', targetId: user.id, ip: req.ip });
    return { recoveryCodes: codes };
  }

  private async clear(userId: string) {
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ totp_secret: null, totp_enabled_at: null, totp_last_step: null }).where('id', '=', userId).execute();
      await trx.deleteFrom('recovery_codes').where('user_id', '=', userId).execute();
    });
  }

  /**
   * Un admin lève la double authentification d'un compte (téléphone perdu, plus
   * de codes de secours). La personne est prévenue par email.
   */
  async adminReset(actor: User, userId: string, ip: string): Promise<void> {
    if (!canManageAccounts(actor.workspace_role)) throw new ForbiddenException("Réservé aux admins de l'espace.");
    const target = await this.db.selectFrom('users').selectAll().where('id', '=', userId).where('workspace_id', '=', actor.workspace_id).executeTakeFirst();
    if (!target) throw new NotFoundException('Compte introuvable.');
    if (!canManageAccount({ userId: actor.id, role: actor.workspace_role }, { userId: target.id, role: target.workspace_role })) {
      throw new ForbiddenException(actor.id === target.id ? 'Désactivez votre propre double authentification depuis Mon compte.' : 'Seul un propriétaire peut modifier ce compte.');
    }
    if (!this.enabledFor(target)) throw new ConflictException('Ce compte n’a pas de double authentification.');
    await this.clear(target.id);
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'account.mfa_reset', targetType: 'user', targetId: target.id, ip });
    // Dans la langue de la personne visée.
    const locale = target.locale;
    await this.mail.send({
      to: target.email,
      locale,
      subject: tr(locale, 'Votre double authentification Andal a été levée'),
      lines: [
        tr(locale, 'Bonjour {name},', { name: target.name }),
        tr(locale, '{actor} a levé la double authentification de votre compte Andal. Seul votre mot de passe protège désormais votre compte.', { actor: actor.name }),
      ],
      action: { label: tr(locale, 'La réactiver'), url: `${config.webOrigin}/compte` },
      footer: tr(locale, 'Si vous n’avez rien demandé, prévenez un admin de votre espace et changez votre mot de passe.'),
    });
  }
}
