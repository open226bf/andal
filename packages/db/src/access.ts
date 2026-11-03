import { archivedRole, minRole, pageRole, projectRole, type Grant, type ProjectRole, type Restriction, type Subject } from '@andal/authz';
import type { Kysely } from 'kysely';
import type { Database, User } from './schema.js';

/**
 * Lecture des droits depuis la base. Les décisions restent dans @andal/authz;
 * ce module ne fait que charger les grants et les restrictions.
 */

export interface LoadedSubject {
  user: User;
  subject: Subject;
}

export async function loadSubject(db: Kysely<Database>, userId: string): Promise<LoadedSubject | null> {
  const user = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst();
  if (!user) return null;
  const groups = await db.selectFrom('group_members').select('group_id').where('user_id', '=', userId).execute();
  return {
    user,
    subject: { userId: user.id, workspaceRole: user.workspace_role, groupIds: groups.map((g) => g.group_id) },
  };
}

export async function projectGrants(db: Kysely<Database>, projectId: string): Promise<Grant[]> {
  const rows = await db.selectFrom('project_members').selectAll().where('project_id', '=', projectId).execute();
  return rows.map((r) => ({ principal: { type: r.principal_type, id: r.principal_id }, role: r.role }));
}

async function isArchived(db: Kysely<Database>, projectId: string): Promise<boolean> {
  const project = await db.selectFrom('projects').select('archived_at').where('id', '=', projectId).executeTakeFirst();
  return Boolean(project?.archived_at);
}

/** Rôle sur un volume, plafonné à la lecture s'il est archivé. */
export async function projectRoleFor(db: Kysely<Database>, subject: Subject, projectId: string): Promise<ProjectRole | null> {
  const [grants, archived] = await Promise.all([projectGrants(db, projectId), isArchived(db, projectId)]);
  return archivedRole(projectRole(subject, grants), archived);
}

/**
 * Rôle effectif sur une page, en tenant compte des restrictions de toute la chaîne d'ancêtres.
 * Une page à la corbeille n'existe plus pour personne, sauf pour décider qui peut la restaurer.
 */
export async function pageRoleFor(
  db: Kysely<Database>,
  subject: Subject,
  pageId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<{ projectId: string; role: ProjectRole | null } | null> {
  const page = await db
    .selectFrom('pages')
    .innerJoin('projects', 'projects.id', 'pages.project_id')
    .select(['pages.id', 'pages.project_id', 'pages.path', 'pages.deleted_at', 'pages.git_sync_id', 'projects.archived_at'])
    .where('pages.id', '=', pageId)
    .executeTakeFirst();
  if (!page) return null;
  if (page.deleted_at && !options.includeDeleted) return { projectId: page.project_id, role: null };
  const [grants, restrictions] = await Promise.all([
    projectGrants(db, page.project_id),
    db
      .selectFrom('page_restrictions as r')
      .innerJoin('pages as p', 'p.id', 'r.page_id')
      .select(['r.page_id', 'r.kind', 'r.principal_type', 'r.principal_id'])
      .where(({ eb, ref, val }) => eb(ref('p.path'), '@>', val(page.path)))
      .execute(),
  ]);
  return {
    projectId: page.project_id,
    role: gitLocked(archivedRole(pageRole(subject, grants, restrictions.map(toRestriction)), page.archived_at !== null), page.git_sync_id !== null),
  };
}

/**
 * Rôle de chaque compte actif de l'espace sur une page (ceux qui n'y ont pas
 * accès sont absents). Sert à proposer qui citer et à décider qui prévenir.
 */
export async function pageRolesForAll(db: Kysely<Database>, pageId: string): Promise<Map<string, ProjectRole>> {
  const page = await db
    .selectFrom('pages')
    .innerJoin('projects', 'projects.id', 'pages.project_id')
    .select(['pages.project_id', 'pages.path', 'pages.git_sync_id', 'projects.workspace_id', 'projects.archived_at'])
    .where('pages.id', '=', pageId)
    .where('pages.deleted_at', 'is', null)
    .executeTakeFirst();
  const roles = new Map<string, ProjectRole>();
  if (!page) return roles;
  const [grants, restrictions, users, memberships] = await Promise.all([
    projectGrants(db, page.project_id),
    db
      .selectFrom('page_restrictions as r')
      .innerJoin('pages as p', 'p.id', 'r.page_id')
      .select(['r.page_id', 'r.kind', 'r.principal_type', 'r.principal_id'])
      .where(({ eb, ref, val }) => eb(ref('p.path'), '@>', val(page.path)))
      .execute(),
    db.selectFrom('users').select(['id', 'workspace_role']).where('workspace_id', '=', page.workspace_id).where('disabled_at', 'is', null).execute(),
    db.selectFrom('group_members').innerJoin('groups', 'groups.id', 'group_members.group_id').select(['group_members.user_id', 'group_members.group_id']).where('groups.workspace_id', '=', page.workspace_id).execute(),
  ]);
  const chain = restrictions.map(toRestriction);
  for (const user of users) {
    const subject: Subject = { userId: user.id, workspaceRole: user.workspace_role, groupIds: memberships.filter((m) => m.user_id === user.id).map((m) => m.group_id) };
    const role = gitLocked(archivedRole(pageRole(subject, grants, chain), page.archived_at !== null), page.git_sync_id !== null);
    if (role) roles.set(user.id, role);
  }
  return roles;
}

export interface TreeRow {
  id: string;
  parent_id: string | null;
  path: string;
  position: number;
  title: string;
  updated_at: Date;
  restricted: boolean;
  /** Synchronisée depuis un dépôt Git: lecture et commentaires seulement. */
  git: boolean;
  role: ProjectRole;
}

/** Pages d'un projet que le sujet peut lire, avec son rôle sur chacune. */
export async function readablePages(db: Kysely<Database>, subject: Subject, projectId: string): Promise<TreeRow[]> {
  const [grants, archived, pages, restrictions] = await Promise.all([
    projectGrants(db, projectId),
    isArchived(db, projectId),
    db
      .selectFrom('pages')
      .select(['id', 'parent_id', 'path', 'position', 'title', 'updated_at', 'git_sync_id'])
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .orderBy('position')
      .orderBy('created_at')
      .execute(),
    db
      .selectFrom('page_restrictions as r')
      .innerJoin('pages as p', 'p.id', 'r.page_id')
      .select(['r.page_id', 'r.kind', 'r.principal_type', 'r.principal_id', 'p.path'])
      .where('p.project_id', '=', projectId)
      .execute(),
  ]);

  const rows: TreeRow[] = [];
  for (const page of pages) {
    const chain = restrictions.filter((r) => page.path === r.path || page.path.startsWith(`${r.path}.`));
    const role = gitLocked(archivedRole(pageRole(subject, grants, chain.map(toRestriction)), archived), page.git_sync_id !== null);
    if (!role) continue;
    const { git_sync_id, ...rest } = page;
    rows.push({
      ...rest,
      git: git_sync_id !== null,
      updated_at: new Date(page.updated_at),
      restricted: chain.length > 0,
      role,
    });
  }
  return rows;
}

/**
 * Une page synchronisée depuis Git s'écrit dans le dépôt: dans Andal, on la
 * lit et on la commente, sans la modifier (rôle plafonné à commentateur).
 */
export function gitLocked(role: ProjectRole | null, managed: boolean): ProjectRole | null {
  return role && managed ? minRole(role, 'commenter') : role;
}

function toRestriction(r: { page_id: string; kind: 'view' | 'edit'; principal_type: 'user' | 'group'; principal_id: string }): Restriction {
  return { pageId: r.page_id, kind: r.kind, principal: { type: r.principal_type, id: r.principal_id } };
}
