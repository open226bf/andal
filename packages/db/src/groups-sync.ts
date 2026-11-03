import { sql, type Kysely } from 'kysely';
import type { Database, GroupSource } from './schema.js';

/**
 * Groupes tenus par le fournisseur d'identité: le claim de groupes du SSO
 * (à chaque connexion) ou SCIM (à chaque envoi). Andal n'en modifie ni le nom
 * ni les membres; il les ouvre aux volumes comme les autres.
 */

const NAME_MAX = 60;

/**
 * Les valeurs du claim de groupes: une liste, ou une chaîne séparée par des
 * virgules. Keycloak en chemin complet envoie « /paiements/equipe »: la barre
 * de tête tombe, le reste du chemin sert d'identifiant.
 */
export function ssoGroupNames(claim: unknown): string[] {
  const list: unknown[] = Array.isArray(claim) ? claim : typeof claim === 'string' ? claim.split(',') : [];
  const names = list
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().replace(/^\/+/, ''))
    .filter((v) => v.length > 0 && v.length <= 200);
  const seen = new Set<string>();
  return names.filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, 200);
}

/** Le nom affiché: le dernier segment du chemin, et « (SSO) » si un groupe local le porte déjà. */
export async function freeGroupName(db: Kysely<Database>, workspaceId: string, wanted: string, suffix: string): Promise<string> {
  const base = (wanted.split('/').pop() || wanted).trim().replace(/\s+/g, ' ').slice(0, NAME_MAX - suffix.length - 4) || 'Groupe';
  const taken = new Set(
    (await db.selectFrom('groups').select(sql<string>`lower(name)`.as('n')).where('workspace_id', '=', workspaceId).execute()).map((r) => r.n),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 1; ; i += 1) {
    const candidate = `${base} (${suffix}${i > 1 ? ` ${i}` : ''})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Trouve ou crée le groupe externe `externalId` de cette source. */
export async function externalGroup(db: Kysely<Database>, workspaceId: string, source: Exclude<GroupSource, 'local'>, externalId: string, displayName = externalId): Promise<{ id: string; name: string; created: boolean }> {
  const found = await db
    .selectFrom('groups')
    .select(['id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .where('source', '=', source)
    .where(sql<string>`lower(external_id)`, '=', externalId.toLowerCase())
    .executeTakeFirst();
  if (found) return { ...found, created: false };
  const name = await freeGroupName(db, workspaceId, displayName, source === 'sso' ? 'SSO' : 'SCIM');
  const created = await db.insertInto('groups').values({ workspace_id: workspaceId, name, source, external_id: externalId }).returning(['id', 'name']).executeTakeFirstOrThrow();
  return { ...created, created: true };
}

export interface GroupSyncResult {
  added: string[];
  removed: string[];
  created: { id: string; name: string }[];
}

/**
 * À la connexion SSO: la personne entre dans les groupes que nomme le claim
 * et sort des autres groupes SSO. Les groupes locaux et SCIM ne bougent pas.
 */
export async function syncSsoGroups(db: Kysely<Database>, user: { id: string; workspace_id: string }, names: string[]): Promise<GroupSyncResult> {
  return db.transaction().execute(async (trx) => {
    const created: GroupSyncResult['created'] = [];
    const wanted = new Set<string>();
    for (const name of names) {
      const group = await externalGroup(trx, user.workspace_id, 'sso', name);
      if (group.created) created.push({ id: group.id, name: group.name });
      wanted.add(group.id);
    }
    const current = await trx
      .selectFrom('group_members as m')
      .innerJoin('groups as g', 'g.id', 'm.group_id')
      .select('m.group_id')
      .where('m.user_id', '=', user.id)
      .where('g.source', '=', 'sso')
      .execute();
    const have = new Set(current.map((r) => r.group_id));
    const added = [...wanted].filter((id) => !have.has(id));
    const removed = [...have].filter((id) => !wanted.has(id));
    if (added.length) await trx.insertInto('group_members').values(added.map((group_id) => ({ group_id, user_id: user.id }))).onConflict((oc) => oc.doNothing()).execute();
    if (removed.length) await trx.deleteFrom('group_members').where('user_id', '=', user.id).where('group_id', 'in', removed).execute();
    return { added, removed, created };
  });
}
