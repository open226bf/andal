import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_PATTERN,
  externalGroup,
  freeGroupName,
  freeUsername,
  initialsOf,
  linkTokenHash,
  profileColor,
  SCIM_TOKEN_PREFIX,
  suggestUsername,
  type Database,
  type User,
} from '@andal/db';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { config } from '../env.js';
import { DB } from '../infra.module.js';

export const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

const MAX_RESULTS = 200;

/** Erreur SCIM avec son `scimType` (uniqueness, invalidFilter, invalidValue…). */
export class ScimError extends HttpException {
  constructor(status: number, detail: string, readonly scimType?: string) {
    super(detail, status);
  }
}

type Json = Record<string, unknown>;

export interface ScimContext {
  workspaceId: string;
  tokenId: string;
}

interface Filter {
  attribute: string;
  value: string;
}

/** `userName eq "lea@exemple.org"`: la seule forme que les fournisseurs envoient pour retrouver un compte ou un groupe. */
export function parseFilter(raw: unknown): Filter | null {
  if (raw === undefined || raw === '') return null;
  const match = typeof raw === 'string' ? /^\s*([\w.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(raw) : null;
  if (!match) throw new ScimError(400, 'Filtre non pris en charge: seulement « attribut eq "valeur" ».', 'invalidFilter');
  return { attribute: match[1]!.toLowerCase(), value: match[2]!.replace(/\\(.)/g, '$1') };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** SCIM envoie parfois les booléens en texte (« False »). */
function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  return null;
}

function primaryEmail(body: Json): string | null {
  const emails = Array.isArray(body.emails) ? (body.emails as Json[]) : [];
  const chosen = emails.find((e) => e?.primary === true || e?.primary === 'true') ?? emails.find((e) => e?.type === 'work') ?? emails[0];
  const fromList = str(chosen?.value);
  const userName = str(body.userName);
  const email = (fromList ?? (userName && EMAIL_PATTERN.test(userName) ? userName : null))?.toLowerCase() ?? null;
  return email && EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null;
}

function displayName(body: Json, fallback: string): string {
  const name = (body.name ?? {}) as Json;
  const parts = [str(name.givenName), str(name.familyName)].filter(Boolean).join(' ');
  return (str(body.displayName) ?? str(name.formatted) ?? (parts || null) ?? fallback).slice(0, 80);
}

/**
 * Provisionnement SCIM 2.0 (RFC 7643/7644) par le fournisseur d'identité:
 * comptes (création, mise à jour, désactivation, retrait) et groupes SCIM avec
 * leurs membres. Authentifié par le jeton SCIM de l'espace, jamais par une session.
 */
@Injectable()
export class ScimService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bridge: CollabBridgeService,
    private readonly sessions: SessionsService,
  ) {}

  private get base(): string {
    return `${config.webOrigin}/api/scim/v2`;
  }

  async authenticate(header: string | undefined): Promise<ScimContext> {
    const token = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
    if (!token || !token.startsWith(SCIM_TOKEN_PREFIX)) throw new ScimError(401, 'Jeton SCIM absent ou invalide.');
    const row = await this.db.selectFrom('scim_tokens').select(['id', 'workspace_id', 'last_used_at']).where('token_hash', '=', linkTokenHash(token)).where('revoked_at', 'is', null).executeTakeFirst();
    if (!row) throw new ScimError(401, 'Jeton SCIM absent ou invalide.');
    if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000) {
      await this.db.updateTable('scim_tokens').set({ last_used_at: new Date() }).where('id', '=', row.id).execute();
    }
    return { workspaceId: row.workspace_id, tokenId: row.id };
  }

  private record(ctx: ScimContext, action: string, targetType: 'user' | 'group', targetId: string, metadata: Json = {}) {
    return this.audit.record({ workspaceId: ctx.workspaceId, actorId: null, action, targetType, targetId, metadata: { via: 'scim', ...metadata } });
  }

  private list(resources: Json[], total: number, startIndex: number) {
    return { schemas: [SCIM_LIST], totalResults: total, startIndex, itemsPerPage: resources.length, Resources: resources };
  }

  private paging(query: Json) {
    const startIndex = Math.max(1, Number(query.startIndex) || 1);
    const count = Math.min(MAX_RESULTS, Math.max(0, Number.isFinite(Number(query.count)) && query.count !== undefined ? Number(query.count) : 100));
    return { startIndex, count };
  }

  /* ---------- Comptes ---------- */

  private async userResource(user: User): Promise<Json> {
    const groups = await this.db
      .selectFrom('group_members as m')
      .innerJoin('groups as g', 'g.id', 'm.group_id')
      .select(['g.id', 'g.name'])
      .where('m.user_id', '=', user.id)
      .where('g.source', '=', 'scim')
      .execute();
    return {
      schemas: [SCIM_USER],
      id: user.id,
      ...(user.scim_external_id ? { externalId: user.scim_external_id } : {}),
      userName: user.email,
      name: { formatted: user.name },
      displayName: user.name,
      emails: [{ value: user.email, type: 'work', primary: true }],
      active: user.disabled_at === null,
      groups: groups.map((g) => ({ value: g.id, display: g.name, $ref: `${this.base}/Groups/${g.id}` })),
      meta: { resourceType: 'User', created: user.created_at.toISOString(), lastModified: (user.disabled_at ?? user.last_login_at ?? user.created_at).toISOString(), location: `${this.base}/Users/${user.id}` },
    };
  }

  private users(ctx: ScimContext) {
    return this.db.selectFrom('users').selectAll().where('workspace_id', '=', ctx.workspaceId).where('deprovisioned_at', 'is', null);
  }

  private async user(ctx: ScimContext, id: string): Promise<User> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ScimError(404, 'Compte introuvable.');
    const user = await this.users(ctx).where('id', '=', id).executeTakeFirst();
    if (!user) throw new ScimError(404, 'Compte introuvable.');
    return user;
  }

  async listUsers(ctx: ScimContext, query: Json) {
    const filter = parseFilter(query.filter);
    const { startIndex, count } = this.paging(query);
    let base = this.users(ctx);
    if (filter) {
      const v = filter.value.toLowerCase();
      if (filter.attribute === 'username' || filter.attribute === 'emails.value' || filter.attribute === 'emails') base = base.where((eb) => eb.or([eb(sql`lower(email)`, '=', v), eb(sql`lower(username)`, '=', v)]));
      else if (filter.attribute === 'externalid') base = base.where('scim_external_id', '=', filter.value);
      else if (filter.attribute === 'id') base = /^[0-9a-f-]{36}$/i.test(v) ? base.where('id', '=', v) : base.where(sql<boolean>`false`);
      else if (filter.attribute === 'displayname') base = base.where(sql`lower(name)`, '=', v);
      else throw new ScimError(400, `Filtre sur « ${filter.attribute} » non pris en charge.`, 'invalidFilter');
    }
    const total = Number((await base.clearSelect().select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
    const rows = count === 0 ? [] : await base.orderBy('created_at').orderBy('id').offset(startIndex - 1).limit(count).execute();
    return this.list(await Promise.all(rows.map((u) => this.userResource(u))), total, startIndex);
  }

  async getUser(ctx: ScimContext, id: string) {
    return this.userResource(await this.user(ctx, id));
  }

  async createUser(ctx: ScimContext, body: Json) {
    const email = primaryEmail(body);
    if (!email) throw new ScimError(400, 'Il faut une adresse email (userName ou emails).', 'invalidValue');
    const externalId = str(body.externalId);
    const active = bool(body.active) ?? true;
    const existing = await this.db.selectFrom('users').selectAll().where('workspace_id', '=', ctx.workspaceId).where(sql`lower(email)`, '=', email).executeTakeFirst();
    if (existing && !existing.deprovisioned_at) throw new ScimError(409, 'Un compte existe déjà pour cette adresse.', 'uniqueness');

    const name = displayName(body, email.split('@')[0]!);
    let user: User;
    if (existing) {
      // Retiré puis revenu: le même compte reprend, avec son historique.
      user = await this.db
        .updateTable('users')
        .set({ deprovisioned_at: null, disabled_at: active ? null : new Date(), name, initials: initialsOf(name), scim_external_id: externalId })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    } else {
      const userName = str(body.userName);
      const wanted = userName && !EMAIL_PATTERN.test(userName) ? userName.toLowerCase().replace(/[^a-z0-9._-]/g, '') : suggestUsername(email);
      const count = Number((await this.db.selectFrom('users').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
      try {
        user = await this.db
          .insertInto('users')
          .values({
            workspace_id: ctx.workspaceId,
            email,
            username: await freeUsername(this.db, ctx.workspaceId, wanted),
            name,
            initials: initialsOf(name),
            color: profileColor(count),
            // Comme une invitation: membre, sans volume tant qu'un admin ou un groupe ne lui en ouvre pas.
            workspace_role: 'member',
            scim_external_id: externalId,
            disabled_at: active ? null : new Date(),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new ScimError(409, 'Ce compte existe déjà (email ou externalId).', 'uniqueness');
        throw error;
      }
    }
    await this.record(ctx, 'scim.user_created', 'user', user.id, { email, reactivated: Boolean(existing) });
    return this.userResource(user);
  }

  /** Applique des changements de compte: nom, email, externalId, actif. */
  private async applyUser(ctx: ScimContext, user: User, changes: { name?: string; email?: string; externalId?: string | null; active?: boolean }) {
    const set: Partial<{ name: string; initials: string; email: string; scim_external_id: string | null; disabled_at: Date | null }> = {};
    if (changes.name && changes.name !== user.name) Object.assign(set, { name: changes.name, initials: initialsOf(changes.name) });
    if (changes.email && changes.email !== user.email.toLowerCase()) set.email = changes.email;
    if (changes.externalId !== undefined && changes.externalId !== user.scim_external_id) set.scim_external_id = changes.externalId;
    const deactivate = changes.active === false && user.disabled_at === null;
    const reactivate = changes.active === true && user.disabled_at !== null;
    if (deactivate) {
      await this.keepAnOwner(user);
      set.disabled_at = new Date();
    }
    if (reactivate) set.disabled_at = null;
    if (Object.keys(set).length === 0) return user;
    let updated: User;
    try {
      updated = await this.db.updateTable('users').set(set).where('id', '=', user.id).returningAll().executeTakeFirstOrThrow();
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ScimError(409, 'Cette adresse ou cet externalId est déjà pris.', 'uniqueness');
      throw error;
    }
    if (deactivate) await this.endSessions(updated);
    await this.record(ctx, deactivate ? 'scim.user_deactivated' : reactivate ? 'scim.user_reactivated' : 'scim.user_updated', 'user', user.id, { fields: Object.keys(set) });
    return updated;
  }

  /** Le fournisseur ne retire pas le dernier propriétaire actif: l'espace resterait sans maître. */
  private async keepAnOwner(user: User) {
    if (user.workspace_role !== 'owner') return;
    const others = await this.db
      .selectFrom('users')
      .select(sql<string>`count(*)`.as('n'))
      .where('workspace_id', '=', user.workspace_id)
      .where('workspace_role', '=', 'owner')
      .where('disabled_at', 'is', null)
      .where('id', '!=', user.id)
      .executeTakeFirstOrThrow();
    if (Number(others.n) === 0) throw new ScimError(409, "Dernier propriétaire actif de l'espace: Andal ne le désactive pas.", 'mutability');
  }

  private async endSessions(user: User) {
    await this.sessions.revoke(user, { allExcept: null });
    await this.bridge.kick(user.id);
  }

  async replaceUser(ctx: ScimContext, id: string, body: Json) {
    const user = await this.user(ctx, id);
    const email = primaryEmail(body);
    const updated = await this.applyUser(ctx, user, {
      name: displayName(body, user.name),
      ...(email ? { email } : {}),
      externalId: str(body.externalId),
      ...(bool(body.active) !== null ? { active: bool(body.active)! } : {}),
    });
    return this.userResource(updated);
  }

  async patchUser(ctx: ScimContext, id: string, body: Json) {
    const user = await this.user(ctx, id);
    const changes: { name?: string; email?: string; externalId?: string | null; active?: boolean } = {};
    const name: Json = {};
    for (const op of this.operations(body)) {
      const kind = String(op.op ?? '').toLowerCase();
      if (kind !== 'add' && kind !== 'replace' && kind !== 'remove') throw new ScimError(400, `Opération « ${String(op.op)} » inconnue.`, 'invalidSyntax');
      // Sans chemin, la valeur est un objet d'attributs (Okta).
      const entries: [string, unknown][] = op.path ? [[String(op.path), op.value]] : Object.entries((op.value ?? {}) as Json);
      for (const [rawPath, value] of entries) {
        const path = rawPath.toLowerCase();
        if (path === 'active') {
          const active = kind === 'remove' ? null : bool(value);
          if (active === null) throw new ScimError(400, '« active » attend un booléen.', 'invalidValue');
          changes.active = active;
        } else if (path === 'externalid') changes.externalId = kind === 'remove' ? null : str(value);
        else if (path === 'displayname' || path === 'name.formatted') name.formatted = str(value);
        else if (path === 'name.givenname') name.givenName = str(value);
        else if (path === 'name.familyname') name.familyName = str(value);
        else if (path === 'name' && value && typeof value === 'object') Object.assign(name, value);
        else if (path === 'username' || path.startsWith('emails')) {
          const email = typeof value === 'string' ? value : primaryEmail({ emails: Array.isArray(value) ? value : [value] });
          if (email && EMAIL_PATTERN.test(email)) changes.email = email.toLowerCase();
        }
        // Le reste (téléphone, titre, manager…) n'existe pas dans Andal: ignoré sans erreur, comme le veut la RFC pour un attribut non géré.
      }
    }
    if (Object.keys(name).length) {
      // Andal ne garde qu'un nom complet: un prénom ou un nom seul remplace sa part du nom actuel.
      if (!name.formatted && (name.givenName === undefined || name.familyName === undefined)) {
        const [given = '', ...family] = user.name.split(' ');
        name.givenName ??= given;
        name.familyName ??= family.join(' ');
      }
      changes.name = displayName({ name }, user.name);
    }
    return this.userResource(await this.applyUser(ctx, user, changes));
  }

  /** Retrait: le compte est désactivé et disparaît de l'annuaire SCIM; son historique reste dans Andal. */
  async deleteUser(ctx: ScimContext, id: string) {
    const user = await this.user(ctx, id);
    if (user.disabled_at === null) await this.keepAnOwner(user);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ disabled_at: user.disabled_at ?? new Date(), deprovisioned_at: new Date(), scim_external_id: null }).where('id', '=', user.id).execute();
      await trx
        .deleteFrom('group_members')
        .where('user_id', '=', user.id)
        .where('group_id', 'in', (eb) => eb.selectFrom('groups').select('id').where('source', '=', 'scim'))
        .execute();
    });
    await this.endSessions(user);
    await this.bridge.accessChanged();
    await this.record(ctx, 'scim.user_deleted', 'user', user.id, { email: user.email });
  }

  private operations(body: Json): Json[] {
    const ops = body.Operations ?? body.operations;
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > 1000) throw new ScimError(400, 'PatchOp: « Operations » manquant.', 'invalidSyntax');
    return ops as Json[];
  }

  /* ---------- Groupes ---------- */

  private async groupResource(group: { id: string; name: string; external_id: string | null }, withMembers = true): Promise<Json> {
    const members = withMembers
      ? await this.db.selectFrom('group_members as m').innerJoin('users as u', 'u.id', 'm.user_id').select(['u.id', 'u.name']).where('m.group_id', '=', group.id).orderBy('u.name').execute()
      : null;
    return {
      schemas: [SCIM_GROUP],
      id: group.id,
      ...(group.external_id ? { externalId: group.external_id } : {}),
      displayName: group.name,
      ...(members ? { members: members.map((m) => ({ value: m.id, display: m.name, $ref: `${this.base}/Users/${m.id}` })) } : {}),
      meta: { resourceType: 'Group', location: `${this.base}/Groups/${group.id}` },
    };
  }

  private groups(ctx: ScimContext) {
    return this.db.selectFrom('groups').select(['id', 'name', 'external_id']).where('workspace_id', '=', ctx.workspaceId).where('source', '=', 'scim');
  }

  private async group(ctx: ScimContext, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ScimError(404, 'Groupe introuvable.');
    const group = await this.groups(ctx).where('id', '=', id).executeTakeFirst();
    if (!group) throw new ScimError(404, 'Groupe introuvable.');
    return group;
  }

  async listGroups(ctx: ScimContext, query: Json) {
    const filter = parseFilter(query.filter);
    const { startIndex, count } = this.paging(query);
    let base = this.groups(ctx);
    if (filter) {
      if (filter.attribute === 'displayname') base = base.where(sql`lower(name)`, '=', filter.value.toLowerCase());
      else if (filter.attribute === 'externalid') base = base.where('external_id', '=', filter.value);
      else if (filter.attribute === 'id') base = /^[0-9a-f-]{36}$/i.test(filter.value) ? base.where('id', '=', filter.value) : base.where(sql<boolean>`false`);
      else throw new ScimError(400, `Filtre sur « ${filter.attribute} » non pris en charge.`, 'invalidFilter');
    }
    const withMembers = !String(query.excludedAttributes ?? '').toLowerCase().includes('members');
    const total = Number((await base.clearSelect().select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
    const rows = count === 0 ? [] : await base.orderBy(sql`lower(name)`).orderBy('id').offset(startIndex - 1).limit(count).execute();
    return this.list(await Promise.all(rows.map((g) => this.groupResource(g, withMembers))), total, startIndex);
  }

  async getGroup(ctx: ScimContext, id: string, query: Json) {
    return this.groupResource(await this.group(ctx, id), !String(query.excludedAttributes ?? '').toLowerCase().includes('members'));
  }

  /** Les membres nommés, limités aux comptes de l'espace. Un identifiant inconnu est une erreur: le fournisseur doit d'abord créer le compte. */
  private async memberIds(ctx: ScimContext, value: unknown): Promise<string[]> {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    const ids = [...new Set(list.map((m) => str((m as Json)?.value)).filter((v): v is string => v !== null))];
    if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new ScimError(400, 'Membre inconnu.', 'invalidValue');
    if (ids.length === 0) return [];
    const found = await this.db.selectFrom('users').select('id').where('workspace_id', '=', ctx.workspaceId).where('deprovisioned_at', 'is', null).where('id', 'in', ids).execute();
    if (found.length !== ids.length) throw new ScimError(400, 'Un des membres n’existe pas dans cet espace.', 'invalidValue');
    return ids;
  }

  async createGroup(ctx: ScimContext, body: Json) {
    const name = str(body.displayName);
    if (!name) throw new ScimError(400, 'displayName manquant.', 'invalidValue');
    const externalId = str(body.externalId);
    const members = await this.memberIds(ctx, body.members);
    if (externalId && (await this.groups(ctx).where('external_id', '=', externalId).executeTakeFirst())) throw new ScimError(409, 'Un groupe porte déjà cet externalId.', 'uniqueness');
    const group = externalId
      ? await externalGroup(this.db, ctx.workspaceId, 'scim', externalId, name)
      : await this.db
          .insertInto('groups')
          .values({ workspace_id: ctx.workspaceId, name: await freeGroupName(this.db, ctx.workspaceId, name, 'SCIM'), source: 'scim' })
          .returning(['id', 'name'])
          .executeTakeFirstOrThrow();
    if (members.length) await this.db.insertInto('group_members').values(members.map((user_id) => ({ group_id: group.id, user_id }))).onConflict((oc) => oc.doNothing()).execute();
    await this.record(ctx, 'scim.group_created', 'group', group.id, { name: group.name, members: members.length });
    if (members.length) await this.bridge.accessChanged();
    return this.groupResource(await this.group(ctx, group.id));
  }

  private async rename(ctx: ScimContext, group: { id: string; name: string }, wanted: string | null) {
    if (!wanted || wanted === group.name) return;
    const name = await freeGroupName(this.db, ctx.workspaceId, wanted, 'SCIM');
    if (name === group.name) return;
    await this.db.updateTable('groups').set({ name }).where('id', '=', group.id).execute();
  }

  private async setMembers(groupId: string, add: string[], remove: string[]) {
    if (add.length) await this.db.insertInto('group_members').values(add.map((user_id) => ({ group_id: groupId, user_id }))).onConflict((oc) => oc.doNothing()).execute();
    if (remove.length) await this.db.deleteFrom('group_members').where('group_id', '=', groupId).where('user_id', 'in', remove).execute();
  }

  async replaceGroup(ctx: ScimContext, id: string, body: Json) {
    const group = await this.group(ctx, id);
    await this.rename(ctx, group, str(body.displayName));
    if (body.externalId !== undefined) await this.db.updateTable('groups').set({ external_id: str(body.externalId) }).where('id', '=', group.id).execute();
    const wanted = await this.memberIds(ctx, body.members);
    const current = (await this.db.selectFrom('group_members').select('user_id').where('group_id', '=', group.id).execute()).map((r) => r.user_id);
    const add = wanted.filter((u) => !current.includes(u));
    const remove = current.filter((u) => !wanted.includes(u));
    await this.setMembers(group.id, add, remove);
    await this.record(ctx, 'scim.group_updated', 'group', group.id, { added: add.length, removed: remove.length });
    if (add.length || remove.length) await this.bridge.accessChanged();
    return this.groupResource(await this.group(ctx, group.id));
  }

  async patchGroup(ctx: ScimContext, id: string, body: Json) {
    const group = await this.group(ctx, id);
    const current = (await this.db.selectFrom('group_members').select('user_id').where('group_id', '=', group.id).execute()).map((r) => r.user_id);
    // Les opérations s'appliquent dans l'ordre à l'ensemble des membres; on n'écrit que la différence.
    let desired = new Set(current);
    for (const op of this.operations(body)) {
      const kind = String(op.op ?? '').toLowerCase();
      if (kind !== 'add' && kind !== 'replace' && kind !== 'remove') throw new ScimError(400, `Opération « ${String(op.op)} » inconnue.`, 'invalidSyntax');
      const path = op.path === undefined || op.path === null ? null : String(op.path);
      const lower = path?.toLowerCase() ?? null;
      if (lower === 'members') {
        if (kind === 'add') for (const m of await this.memberIds(ctx, op.value)) desired.add(m);
        else if (kind === 'replace') desired = new Set(await this.memberIds(ctx, op.value));
        // Sans valeur: tous les membres partent (RFC 7644 §3.5.2.2).
        else if (op.value === undefined) desired.clear();
        else for (const m of await this.memberIds(ctx, op.value)) desired.delete(m);
      } else if (lower?.startsWith('members[')) {
        // Entra ID: « members[value eq "…"] ».
        const member = /^members\[value eq "([^"]+)"\]$/i.exec(path!)?.[1];
        if (!member || kind !== 'remove') throw new ScimError(400, 'Chemin de membre non pris en charge.', 'invalidPath');
        desired.delete(member);
      } else if (lower === 'displayname') {
        await this.rename(ctx, group, kind === 'remove' ? null : str(op.value));
      } else if (lower === 'externalid') {
        await this.db.updateTable('groups').set({ external_id: kind === 'remove' ? null : str(op.value) }).where('id', '=', group.id).execute();
      } else if (lower === null && op.value && typeof op.value === 'object' && !Array.isArray(op.value)) {
        // Sans chemin (Okta): un objet d'attributs.
        const value = op.value as Json;
        if (value.displayName !== undefined) await this.rename(ctx, group, str(value.displayName));
        if (value.externalId !== undefined) await this.db.updateTable('groups').set({ external_id: str(value.externalId) }).where('id', '=', group.id).execute();
        if (value.members !== undefined) {
          const ids = await this.memberIds(ctx, value.members);
          if (kind === 'add') for (const m of ids) desired.add(m);
          else desired = new Set(ids);
        }
      } else {
        throw new ScimError(400, `Chemin « ${path ?? ''} » non pris en charge.`, 'invalidPath');
      }
    }
    const add = [...desired].filter((u) => !current.includes(u));
    const remove = current.filter((u) => !desired.has(u));
    await this.setMembers(group.id, add, remove);
    await this.record(ctx, 'scim.group_updated', 'group', group.id, { added: add.length, removed: remove.length });
    if (add.length || remove.length) await this.bridge.accessChanged();
    return this.groupResource(await this.group(ctx, group.id));
  }

  async deleteGroup(ctx: ScimContext, id: string) {
    const group = await this.group(ctx, id);
    const used = Number(
      (await this.db.selectFrom('page_restrictions').select(sql<string>`count(distinct page_id)`.as('n')).where('principal_type', '=', 'group').where('principal_id', '=', group.id).executeTakeFirstOrThrow()).n,
    );
    // Même règle que dans l'administration: sans ce groupe, une restriction pourrait se vider et ouvrir ses pages.
    if (used > 0) throw new ScimError(409, `Ce groupe restreint ${used} page${used > 1 ? 's' : ''} dans Andal: retirez-le d’abord de ces restrictions.`, 'mutability');
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('project_members').where('principal_type', '=', 'group').where('principal_id', '=', group.id).execute();
      await trx.deleteFrom('groups').where('id', '=', group.id).execute();
    });
    await this.record(ctx, 'scim.group_deleted', 'group', group.id, { name: group.name });
    await this.bridge.accessChanged();
  }

  /* ---------- Découverte ---------- */

  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://github.com/open226bf/andal#directory-sso-and-scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_RESULTS },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Jeton SCIM', description: 'Jeton créé dans Administration → Annuaire.', primary: true }],
      meta: { resourceType: 'ServiceProviderConfig', location: `${this.base}/ServiceProviderConfig` },
    };
  }

  resourceTypes() {
    const types = [
      { id: 'User', name: 'User', endpoint: '/Users', schema: SCIM_USER },
      { id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCIM_GROUP },
    ].map((t) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], ...t, meta: { resourceType: 'ResourceType', location: `${this.base}/ResourceTypes/${t.id}` } }));
    return this.list(types, types.length, 1);
  }

  schemas() {
    const attribute = (name: string, type = 'string', extra: Json = {}) => ({ name, type, multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', ...extra });
    const resources = [
      {
        id: SCIM_USER,
        name: 'User',
        attributes: [
          attribute('userName', 'string', { required: true, uniqueness: 'server' }),
          attribute('name', 'complex', { subAttributes: [attribute('formatted'), attribute('givenName'), attribute('familyName')] }),
          attribute('displayName'),
          attribute('emails', 'complex', { multiValued: true, subAttributes: [attribute('value'), attribute('type'), attribute('primary', 'boolean')] }),
          attribute('active', 'boolean'),
          attribute('groups', 'complex', { multiValued: true, mutability: 'readOnly' }),
        ],
      },
      {
        id: SCIM_GROUP,
        name: 'Group',
        attributes: [attribute('displayName', 'string', { required: true }), attribute('members', 'complex', { multiValued: true, subAttributes: [attribute('value'), attribute('display', 'string', { mutability: 'readOnly' })] })],
      },
    ].map((s) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'], ...s, meta: { resourceType: 'Schema', location: `${this.base}/Schemas/${s.id}` } }));
    return this.list(resources, resources.length, 1);
  }
}
