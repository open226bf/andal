import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { assignableRoles, canManageAccount, canManageAccounts, WORKSPACE_ROLES, type WorkspaceRole } from '@andal/authz';
import {
  EMAIL_PATTERN,
  hashPassword,
  initialsOf,
  linkTokenHash,
  newLinkToken,
  passwordProblem,
  profileColor,
  suggestUsername,
  tr,
  USERNAME_PATTERN,
  type Database,
  type User,
} from '@andal/db';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { config } from '../env.js';
import { DB } from '../infra.module.js';
import { MailService } from '../mail.service.js';

const HOUR = 60 * 60 * 1000;
const INVITE_TTL = 7 * 24 * HOUR;
/** Lien remis par un admin: le temps de le transmettre. Lien demandé soi-même: court. */
const RESET_TTL_BY_ADMIN = 24 * HOUR;
const RESET_TTL_SELF = HOUR;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export interface LinkResult {
  emailed: boolean;
  /** Lien à transmettre soi-même: toujours pour une invitation, pour une réinitialisation seulement sans email. */
  link: string | null;
}

/**
 * Comptes de l'espace: invitations, rôles, désactivation, réinitialisation.
 * Les règles « qui peut gérer qui » viennent de @andal/authz; la règle
 * « il reste au moins un propriétaire actif » est vérifiée ici, en base.
 */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly bridge: CollabBridgeService,
  ) {}

  private assertAdmin(actor: User) {
    if (!canManageAccounts(actor.workspace_role)) throw new ForbiddenException("Réservé aux admins de l'espace.");
  }

  private async target(actor: User, userId: string): Promise<User> {
    const target = await this.db.selectFrom('users').selectAll().where('id', '=', userId).where('workspace_id', '=', actor.workspace_id).executeTakeFirst();
    if (!target) throw new NotFoundException('Compte introuvable.');
    if (!canManageAccount({ userId: actor.id, role: actor.workspace_role }, { userId: target.id, role: target.workspace_role })) {
      throw new ForbiddenException(actor.id === target.id ? 'Vous ne pouvez pas modifier votre propre compte ici.' : 'Seul un propriétaire peut modifier ce compte.');
    }
    return target;
  }

  /** Refuse ce qui laisserait l'espace sans propriétaire actif. */
  private async keepAnOwner(target: User) {
    if (target.workspace_role !== 'owner' || target.disabled_at) return;
    const others = await this.db
      .selectFrom('users')
      .select(sql<string>`count(*)`.as('n'))
      .where('workspace_id', '=', target.workspace_id)
      .where('workspace_role', '=', 'owner')
      .where('disabled_at', 'is', null)
      .where('id', '!=', target.id)
      .executeTakeFirstOrThrow();
    if (Number(others.n) === 0) throw new ConflictException("L'espace doit garder au moins un propriétaire actif.");
  }

  private link(path: string, token: string): string {
    return `${config.webOrigin}/${path}/${token}`;
  }

  /* ---------- Administration ---------- */

  async overview(actor: User) {
    this.assertAdmin(actor);
    const [users, invitations, groups] = await Promise.all([
      this.db.selectFrom('users').selectAll().where('workspace_id', '=', actor.workspace_id).orderBy('name').execute(),
      this.db
        .selectFrom('account_tokens as t')
        .leftJoin('users as u', 'u.id', 't.created_by')
        .select(['t.id', 't.email', 't.name', 't.role', 't.group_ids', 't.expires_at', 't.created_at', 'u.name as invited_by'])
        .where('t.workspace_id', '=', actor.workspace_id)
        .where('t.kind', '=', 'invite')
        .where('t.used_at', 'is', null)
        .orderBy('t.created_at', 'desc')
        .execute(),
      // Les groupes du fournisseur d'identité ne se rejoignent pas par invitation.
      this.db.selectFrom('groups').select(['id', 'name']).where('workspace_id', '=', actor.workspace_id).where('source', '=', 'local').orderBy(sql`lower(name)`).execute(),
    ]);
    const now = Date.now();
    const groupNames = (ids: string[]) => groups.filter((g) => ids.includes(g.id)).map((g) => g.name);
    const roles = assignableRoles(actor.workspace_role);
    return {
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        initials: u.initials,
        color: u.color,
        email: u.email,
        username: u.username,
        role: u.workspace_role,
        disabledAt: u.disabled_at?.toISOString() ?? null,
        lastLoginAt: u.last_login_at?.toISOString() ?? null,
        hasPassword: u.password_hash !== null,
        sso: u.oidc_subject !== null,
        mfa: u.totp_enabled_at !== null,
        scim: u.scim_external_id !== null,
        you: u.id === actor.id,
        manageable: canManageAccount({ userId: actor.id, role: actor.workspace_role }, { userId: u.id, role: u.workspace_role }),
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        name: i.name,
        role: i.role,
        groups: groupNames(i.group_ids),
        invitedBy: i.invited_by,
        createdAt: new Date(i.created_at).toISOString(),
        expiresAt: i.expires_at.toISOString(),
        expired: i.expires_at.getTime() < now,
        manageable: i.role !== null && roles.includes(i.role),
      })),
      assignableRoles: roles,
      groups,
      mail: this.mail.enabled,
      passwordLogin: config.passwordLogin,
    };
  }

  async invite(actor: User, input: { email?: unknown; name?: unknown; role?: unknown; groupIds?: unknown }, ip: string): Promise<LinkResult> {
    this.assertAdmin(actor);
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new BadRequestException('Adresse email invalide.');
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : null;
    const role = input.role as WorkspaceRole;
    if (!assignableRoles(actor.workspace_role).includes(role)) throw new ForbiddenException('Vous ne pouvez pas attribuer ce rôle.');
    const groupIds = await this.groupIds(actor, input.groupIds);

    const existing = await this.db.selectFrom('users').select('id').where('workspace_id', '=', actor.workspace_id).where(sql`lower(email)`, '=', email).executeTakeFirst();
    if (existing) throw new ConflictException('Un compte existe déjà pour cette adresse.');

    const { token, hash } = newLinkToken();
    // Une seule invitation en cours par adresse: la nouvelle remplace l'ancienne.
    await this.db.deleteFrom('account_tokens').where('workspace_id', '=', actor.workspace_id).where('kind', '=', 'invite').where('email', '=', email).where('used_at', 'is', null).execute();
    const created = await this.db
      .insertInto('account_tokens')
      .values({ workspace_id: actor.workspace_id, kind: 'invite', token_hash: hash, email, name, role, group_ids: JSON.stringify(groupIds), created_by: actor.id, expires_at: new Date(Date.now() + INVITE_TTL) })
      .returning('id')
      .executeTakeFirstOrThrow();

    const link = this.link('invitation', token);
    const emailed = await this.sendInvitation(actor, email, link);
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'account.invited', targetType: 'invitation', targetId: created.id, ip, metadata: { email, role, groupIds, emailed } });
    return { emailed, link };
  }

  /** Groupes à rejoindre à l'inscription: des groupes de l'espace, sans doublon. */
  private async groupIds(actor: User, value: unknown): Promise<string[]> {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 50 || value.some((id) => typeof id !== 'string')) throw new BadRequestException('Groupes invalides.');
    const ids = [...new Set(value as string[])];
    if (ids.length === 0) return [];
    if (ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))) throw new BadRequestException('Groupes invalides.');
    const found = await this.db.selectFrom('groups').select('id').where('workspace_id', '=', actor.workspace_id).where('source', '=', 'local').where('id', 'in', ids).execute();
    if (found.length !== ids.length) throw new BadRequestException('Un des groupes n’existe plus.');
    return ids;
  }

  async resendInvitation(actor: User, invitationId: string, ip: string): Promise<LinkResult> {
    this.assertAdmin(actor);
    const invitation = await this.db
      .selectFrom('account_tokens')
      .selectAll()
      .where('id', '=', invitationId)
      .where('workspace_id', '=', actor.workspace_id)
      .where('kind', '=', 'invite')
      .where('used_at', 'is', null)
      .executeTakeFirst();
    if (!invitation) throw new NotFoundException('Invitation introuvable.');
    if (!invitation.role || !assignableRoles(actor.workspace_role).includes(invitation.role)) throw new ForbiddenException('Seul un propriétaire peut renvoyer cette invitation.');

    // Nouveau jeton: l'ancien lien cesse de fonctionner.
    const { token, hash } = newLinkToken();
    await this.db.updateTable('account_tokens').set({ token_hash: hash, expires_at: new Date(Date.now() + INVITE_TTL) }).where('id', '=', invitation.id).execute();
    const link = this.link('invitation', token);
    const emailed = await this.sendInvitation(actor, invitation.email, link);
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'account.invitation_resent', targetType: 'invitation', targetId: invitation.id, ip, metadata: { emailed } });
    return { emailed, link };
  }

  async revokeInvitation(actor: User, invitationId: string, ip: string): Promise<void> {
    this.assertAdmin(actor);
    const deleted = await this.db
      .deleteFrom('account_tokens')
      .where('id', '=', invitationId)
      .where('workspace_id', '=', actor.workspace_id)
      .where('kind', '=', 'invite')
      .where('used_at', 'is', null)
      .returning(['email', 'role'])
      .executeTakeFirst();
    if (!deleted) throw new NotFoundException('Invitation introuvable.');
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'account.invitation_revoked', targetType: 'invitation', targetId: invitationId, ip, metadata: { email: deleted.email } });
  }

  async setRole(actor: User, userId: string, role: unknown, ip: string): Promise<void> {
    this.assertAdmin(actor);
    const target = await this.target(actor, userId);
    if (!WORKSPACE_ROLES.includes(role as WorkspaceRole) || !assignableRoles(actor.workspace_role).includes(role as WorkspaceRole)) {
      throw new ForbiddenException('Vous ne pouvez pas attribuer ce rôle.');
    }
    if (target.workspace_role === role) return;
    if (role !== 'owner') await this.keepAnOwner(target);
    await this.db.updateTable('users').set({ workspace_role: role as WorkspaceRole }).where('id', '=', target.id).execute();
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'account.role_changed', targetType: 'user', targetId: target.id, ip, metadata: { from: target.workspace_role, to: role } });
  }

  async setDisabled(actor: User, userId: string, disabled: boolean, ip: string): Promise<void> {
    this.assertAdmin(actor);
    const target = await this.target(actor, userId);
    if (Boolean(target.disabled_at) === disabled) return;
    if (disabled) await this.keepAnOwner(target);
    await this.db.updateTable('users').set({ disabled_at: disabled ? new Date() : null }).where('id', '=', target.id).execute();
    // Les sessions HTTP tombent à la requête suivante; les connexions temps réel sont coupées tout de suite.
    if (disabled) await this.bridge.kick(target.id);
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: disabled ? 'account.disabled' : 'account.enabled', targetType: 'user', targetId: target.id, ip });
  }

  async adminReset(actor: User, userId: string, ip: string): Promise<LinkResult> {
    this.assertAdmin(actor);
    if (!config.passwordLogin) throw new BadRequestException('La connexion par mot de passe est désactivée sur ce serveur.');
    const target = await this.target(actor, userId);
    if (target.disabled_at) throw new ConflictException("Réactivez d'abord ce compte.");
    const token = await this.createResetToken(target, actor.id, RESET_TTL_BY_ADMIN);
    const link = this.link('reinitialiser', token);
    // Dans la langue de la personne visée.
    const locale = target.locale;
    const emailed = await this.mail.send({
      to: target.email,
      locale,
      subject: tr(locale, 'Choisissez un nouveau mot de passe Andal'),
      lines: [tr(locale, 'Bonjour {name},', { name: target.name }), tr(locale, '{actor} a lancé la réinitialisation de votre mot de passe Andal.', { actor: actor.name })],
      action: { label: tr(locale, 'Choisir un nouveau mot de passe'), url: link },
      footer: tr(locale, 'Ce lien sert une seule fois et expire dans 24 heures. Votre mot de passe actuel reste valable tant que vous ne l’avez pas remplacé.'),
    });
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'account.password_reset_issued', targetType: 'user', targetId: target.id, ip, metadata: { emailed } });
    // Le lien n'est montré à l'admin que s'il n'a pas pu partir par email.
    return { emailed, link: emailed ? null : link };
  }

  private async createResetToken(user: User, createdBy: string | null, ttl: number): Promise<string> {
    const { token, hash } = newLinkToken();
    await this.db.deleteFrom('account_tokens').where('user_id', '=', user.id).where('kind', '=', 'reset').where('used_at', 'is', null).execute();
    await this.db
      .insertInto('account_tokens')
      .values({ workspace_id: user.workspace_id, kind: 'reset', token_hash: hash, email: user.email, user_id: user.id, created_by: createdBy, expires_at: new Date(Date.now() + ttl) })
      .execute();
    return token;
  }

  private async sendInvitation(actor: User, email: string, link: string): Promise<boolean> {
    const workspace = await this.db.selectFrom('workspaces').select('name').where('id', '=', actor.workspace_id).executeTakeFirstOrThrow();
    // Pas encore de compte, donc pas de langue: celle de l'admin qui invite.
    const locale = actor.locale;
    const vars = { actor: actor.name, workspace: workspace.name };
    return this.mail.send({
      to: email,
      locale,
      subject: tr(locale, '{actor} vous invite sur {workspace}', vars),
      lines: [tr(locale, 'Bonjour,'), tr(locale, '{actor} vous invite à rejoindre « {workspace} » sur Andal, la documentation de l’équipe.', vars)],
      action: { label: tr(locale, 'Créer mon compte'), url: link },
      footer: tr(locale, 'Ce lien sert une seule fois et expire dans 7 jours. Si vous n’attendiez pas cette invitation, ignorez cet email.'),
    });
  }

  /* ---------- Liens publics ---------- */

  private async validToken(token: unknown) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw new NotFoundException();
    const row = await this.db
      .selectFrom('account_tokens as t')
      .innerJoin('workspaces as w', 'w.id', 't.workspace_id')
      .leftJoin('users as u', 'u.id', 't.user_id')
      .select(['t.id', 't.kind', 't.email', 't.name', 't.role', 't.group_ids', 't.user_id', 't.workspace_id', 't.expires_at', 't.used_at', 'w.name as workspace', 'u.disabled_at'])
      .where('t.token_hash', '=', linkTokenHash(token))
      .executeTakeFirst();
    // Lien inconnu, déjà utilisé, expiré ou visant un compte désactivé: même réponse.
    if (!row || row.used_at || row.expires_at.getTime() < Date.now() || row.disabled_at) throw new GoneException('Ce lien n’est plus valable.');
    return row;
  }

  async describeLink(token: unknown) {
    const row = await this.validToken(token);
    const groups = row.group_ids.length ? await this.db.selectFrom('groups').select('name').where('id', 'in', row.group_ids).orderBy('name').execute() : [];
    return {
      kind: row.kind,
      email: row.email,
      name: row.name,
      role: row.role,
      groups: groups.map((g) => g.name),
      workspace: row.workspace,
      suggestedUsername: suggestUsername(row.email),
      passwordLogin: config.passwordLogin,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /** Crée le compte invité. Renvoie le compte, à connecter par l'appelant. */
  async acceptInvitation(token: unknown, input: { name?: unknown; username?: unknown; password?: unknown }, ip: string): Promise<User> {
    const invitation = await this.validToken(token);
    if (invitation.kind !== 'invite' || !invitation.role) throw new GoneException('Ce lien n’est plus valable.');
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    if (!name) throw new BadRequestException('Indiquez votre nom.');
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
    if (!USERNAME_PATTERN.test(username)) throw new BadRequestException('Identifiant: 2 à 40 caractères parmi a-z, 0-9, point, tiret et souligné.');

    let passwordHash: string | null = null;
    if (config.passwordLogin) {
      const password = typeof input.password === 'string' ? input.password : '';
      const problem = passwordProblem(password, { email: invitation.email, username });
      if (problem) throw new BadRequestException(problem);
      passwordHash = await hashPassword(password);
    }

    const count = Number((await this.db.selectFrom('users').select(sql<string>`count(*)`.as('n')).where('workspace_id', '=', invitation.workspace_id).executeTakeFirstOrThrow()).n);
    try {
      const user = await this.db.transaction().execute(async (trx) => {
        // Consomme le jeton d'abord: deux envois simultanés ne créent pas deux comptes.
        const used = await trx.updateTable('account_tokens').set({ used_at: new Date() }).where('id', '=', invitation.id).where('used_at', 'is', null).returning('id').executeTakeFirst();
        if (!used) throw new GoneException('Ce lien n’est plus valable.');
        const created = await trx
          .insertInto('users')
          .values({
            workspace_id: invitation.workspace_id,
            email: invitation.email,
            username,
            name,
            initials: initialsOf(name),
            color: profileColor(count),
            workspace_role: invitation.role!,
            password_hash: passwordHash,
            password_changed_at: passwordHash ? new Date() : null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        // Les groupes prévus par l'invitation, s'ils existent encore: les volumes s'ouvrent dès l'arrivée.
        const groups = invitation.group_ids.length
          ? await trx.selectFrom('groups').select('id').where('workspace_id', '=', invitation.workspace_id).where('id', 'in', invitation.group_ids).execute()
          : [];
        if (groups.length) await trx.insertInto('group_members').values(groups.map((g) => ({ group_id: g.id, user_id: created.id }))).execute();
        return created;
      });
      await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'account.invitation_accepted', targetType: 'user', targetId: user.id, ip, metadata: { invitationId: invitation.id } });
      return user;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Cet identifiant ou cette adresse est déjà utilisé.');
      throw error;
    }
  }

  /** Définit le nouveau mot de passe; toutes les sessions du compte sont fermées. */
  async resetPassword(token: unknown, password: unknown, ip: string): Promise<User> {
    const reset = await this.validToken(token);
    if (reset.kind !== 'reset' || !reset.user_id || !config.passwordLogin) throw new GoneException('Ce lien n’est plus valable.');
    const user = await this.db.selectFrom('users').selectAll().where('id', '=', reset.user_id).executeTakeFirstOrThrow();
    const next = typeof password === 'string' ? password : '';
    const problem = passwordProblem(next, user);
    if (problem) throw new BadRequestException(problem);

    const changedAt = new Date();
    const hash = await hashPassword(next);
    const updated = await this.db.transaction().execute(async (trx) => {
      const used = await trx.updateTable('account_tokens').set({ used_at: changedAt }).where('id', '=', reset.id).where('used_at', 'is', null).returning('id').executeTakeFirst();
      if (!used) throw new GoneException('Ce lien n’est plus valable.');
      return trx.updateTable('users').set({ password_hash: hash, password_changed_at: changedAt }).where('id', '=', user.id).returningAll().executeTakeFirstOrThrow();
    });
    await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.password_reset', targetType: 'user', targetId: user.id, ip });
    return updated;
  }

  /**
   * Mot de passe oublié: répond toujours pareil, que le compte existe ou non.
   * L'email part en arrière-plan, pour que le temps de réponse ne trahisse rien.
   */
  async forgotPassword(email: string, ip: string): Promise<void> {
    if (!config.passwordLogin || !this.mail.enabled) return;
    const user = await this.db.selectFrom('users').selectAll().where(sql`lower(email)`, '=', email.trim().toLowerCase()).where('disabled_at', 'is', null).executeTakeFirst();
    if (!user) return;
    void (async () => {
      const token = await this.createResetToken(user, null, RESET_TTL_SELF);
      const locale = user.locale;
      const sent = await this.mail.send({
        to: user.email,
        locale,
        subject: tr(locale, 'Réinitialisation de votre mot de passe Andal'),
        lines: [tr(locale, 'Bonjour {name},', { name: user.name }), tr(locale, 'Quelqu’un, sans doute vous, a demandé à réinitialiser votre mot de passe Andal.')],
        action: { label: tr(locale, 'Choisir un nouveau mot de passe'), url: this.link('reinitialiser', token) },
        footer: tr(locale, 'Ce lien sert une seule fois et expire dans une heure. Si vous n’êtes pas à l’origine de la demande, ignorez cet email: votre mot de passe ne change pas.'),
      });
      await this.audit.record({ workspaceId: user.workspace_id, actorId: null, action: 'auth.password_reset_requested', targetType: 'user', targetId: user.id, ip, metadata: { emailed: sent } });
    })().catch((error: unknown) => console.error('Mot de passe oublié:', error));
  }

  get passwordResetAvailable(): boolean {
    return config.passwordLogin && this.mail.enabled;
  }
}
