import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Post, Put, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import {
  passwordProblem,
  PASSWORD_MAX_LENGTH,
  hashPassword,
  LOCALES,
  sessionKey,
  spendPasswordCheck,
  verifyPassword,
  type Database,
  type Locale,
  type User,
} from '@andal/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { config } from '../env.js';
import { DB, VALKEY } from '../infra.module.js';
import { MailService } from '../mail.service.js';
import { type AuthContext, CurrentAuth, Public, SessionOnly } from './auth.guard.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { MfaService } from './mfa.service.js';
import { OIDC_FLOW_COOKIE, OIDC_FLOW_TTL_SECONDS, OidcService } from './oidc.service.js';
import { SessionsService } from './sessions.service.js';

function publicUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    initials: u.initials,
    color: u.color,
    email: u.email,
    username: u.username,
    workspaceRole: u.workspace_role,
    hasPassword: u.password_hash !== null,
    mfa: u.totp_enabled_at !== null,
    locale: u.locale,
  };
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new BadRequestException(`Champ « ${field} » invalide.`);
  return value;
}

/** N'accepte qu'un chemin local: pas de redirection ouverte vers un autre site. */
function localPath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

@Controller()
export class AuthController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly throttle: LoginThrottleService,
    private readonly oidc: OidcService,
    private readonly mail: MailService,
    private readonly mfa: MfaService,
  ) {}

  /** Ce que l'écran de connexion doit proposer. */
  @Public()
  @Get('auth/config')
  authConfig() {
    return {
      password: config.passwordLogin,
      // « Mot de passe oublié » n'a de sens que si l'email peut partir.
      passwordReset: config.passwordLogin && this.mail.enabled,
      oidc: config.oidc ? { label: config.oidc.label } : null,
    };
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return { user: publicUser(auth.user), auth: { method: auth.session.method } };
  }

  /** Langue de l'interface et des emails de ce compte. */
  @Put('me/locale')
  @HttpCode(204)
  async setLocale(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined) {
    const locale = body?.locale;
    if (!LOCALES.includes(locale as Locale)) throw new BadRequestException('Langue inconnue: « fr » ou « en ».');
    await this.db.updateTable('users').set({ locale: locale as Locale }).where('id', '=', auth.user.id).execute();
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!config.passwordLogin) throw new NotFoundException();
    const identifier = text(body?.identifier, 'identifiant', 254).trim();
    const password = text(body?.password, 'mot de passe', PASSWORD_MAX_LENGTH);
    await this.throttle.guard(identifier, req.ip, reply);

    const login = identifier.toLowerCase();
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb.or([eb(sql`lower(email)`, '=', login), eb(sql`lower(username)`, '=', login)]))
      .executeTakeFirst();
    let valid = false;
    if (user?.password_hash) valid = await verifyPassword(user.password_hash, password);
    else await spendPasswordCheck(password);

    if (!user || !valid) {
      await this.throttle.failed(identifier, req.ip);
      if (user) await this.audit.record({ workspaceId: user.workspace_id, actorId: null, action: 'auth.login_failed', targetType: 'user', targetId: user.id, ip: req.ip });
      // Même message que le compte existe ou non.
      throw new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    }
    // Seul qui connaît le mot de passe apprend que le compte est désactivé.
    if (user.disabled_at) throw new ForbiddenException('Ce compte est désactivé. Contactez un admin de votre espace.');
    await this.throttle.succeeded(identifier);
    // Compte protégé: le mot de passe ne suffit pas, il faut encore le code.
    if (this.mfa.enabledFor(user)) {
      await this.mfa.challenge(user, reply);
      return { mfa: true };
    }
    await this.sessions.open(user, 'password', req, reply);
    return { user: publicUser(user) };
  }

  /** Deuxième étape: le code de l'application, ou un code de secours. */
  @Public()
  @Post('auth/login/mfa')
  @HttpCode(200)
  async loginMfa(@Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!config.passwordLogin) throw new NotFoundException();
    const { user, used } = await this.mfa.complete(req, reply, body?.code);
    await this.sessions.open(user, 'password', req, reply, { mfa: true });
    const left = used === 'recovery' ? (await this.mfa.status(user)).recoveryCodesLeft : null;
    return { user: publicUser(user), recoveryCodesLeft: left };
  }

  @SessionOnly()
  @Post('auth/logout')
  @HttpCode(200)
  async logout(@CurrentAuth() auth: AuthContext, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.close(auth.sessionId, reply);
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'auth.logout', targetType: 'user', targetId: auth.user.id, ip: req.ip });
    // Après un SSO, on ferme aussi la session chez le fournisseur.
    const redirectTo = auth.session.method === 'oidc' ? await this.oidc.logoutUrl(auth.session.idToken) : null;
    return { redirectTo };
  }

  /** Change le mot de passe et ferme toutes les autres sessions du compte. */
  @SessionOnly()
  @Post('auth/password')
  @HttpCode(204)
  async changePassword(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!config.passwordLogin || !auth.user.password_hash) throw new ForbiddenException('Ce compte se connecte par SSO: le mot de passe se gère chez le fournisseur.');
    const current = text(body?.current, 'mot de passe actuel', PASSWORD_MAX_LENGTH);
    const next = text(body?.next, 'nouveau mot de passe', PASSWORD_MAX_LENGTH);
    const account = `password:${auth.user.id}`;
    await this.throttle.guard(account, req.ip, reply);

    if (!(await verifyPassword(auth.user.password_hash, current))) {
      await this.throttle.failed(account, req.ip);
      throw new ForbiddenException('Mot de passe actuel incorrect.');
    }
    const problem = passwordProblem(next, auth.user);
    if (problem) throw new BadRequestException(problem);
    if (next === current) throw new BadRequestException("Choisissez un mot de passe différent de l'actuel.");

    const changedAt = new Date();
    const user = await this.db
      .updateTable('users')
      .set({ password_hash: await hashPassword(next), password_changed_at: changedAt })
      .where('id', '=', auth.user.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.throttle.succeeded(account);
    await this.valkey.del(sessionKey(auth.sessionId));
    // Les sessions antérieures à changedAt deviennent invalides; celle-ci est rouverte à neuf.
    await this.sessions.open(user, 'password', req, reply, { createdAt: changedAt });
    await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.password_changed', targetType: 'user', targetId: user.id, ip: req.ip });
  }

  @Public()
  @Get('auth/oidc')
  async oidcStart(@Query('returnTo') returnTo: unknown, @Res() reply: FastifyReply) {
    if (!this.oidc.enabled) throw new NotFoundException();
    try {
      const { url, flowId } = await this.oidc.start(localPath(returnTo));
      reply.setCookie(OIDC_FLOW_COOKIE, flowId, { path: '/api/auth', httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: OIDC_FLOW_TTL_SECONDS });
      return reply.redirect(url, 302);
    } catch (error) {
      console.error('SSO indisponible:', error);
      return reply.redirect('/login?erreur=sso-indisponible', 302);
    }
  }

  @Public()
  @Get('auth/callback')
  async oidcCallback(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    if (!this.oidc.enabled) throw new NotFoundException();
    const flowId = req.cookies[OIDC_FLOW_COOKIE];
    reply.clearCookie(OIDC_FLOW_COOKIE, { path: '/api/auth' });
    if (!flowId) return reply.redirect('/login?erreur=sso', 302);
    try {
      const result = await this.oidc.finish(flowId, new URL(req.url, config.webOrigin));
      if (!result.user || result.user.disabled_at) {
        // Ferme la session chez le fournisseur: sinon le prochain essai reprendrait la même identité, sans choix possible.
        const after = result.user ? '/login?erreur=sso-desactive' : '/login?erreur=sso-compte';
        return reply.redirect((await this.oidc.logoutUrl(result.idToken, after)) ?? after, 302);
      }
      await this.sessions.open(result.user, 'oidc', req, reply, { idToken: result.idToken });
      return reply.redirect(result.returnTo, 302);
    } catch (error) {
      console.error('Échec du retour SSO:', error);
      return reply.redirect('/login?erreur=sso', 302);
    }
  }
}
