/**
 * Modèle d'accès d'Andal, sans dépendance ni I/O.
 *
 * - Un projet (volume) donne un rôle à des utilisateurs ou à des groupes.
 * - Une page peut être restreinte en lecture ou en écriture; la restriction
 *   s'hérite aux sous-pages et ne fait que réduire les droits.
 * - Tout est refusé par défaut: sans rôle, aucune action n'est permise.
 *
 * L'API, le serveur collab et le worker appellent tous ce module: aucun
 * contrôle d'accès ne doit être écrit ailleurs.
 */

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';
export type ProjectRole = 'reader' | 'commenter' | 'editor' | 'admin';
export type RestrictionKind = 'view' | 'edit';

export type Action =
  | 'page.read'
  | 'page.comment'
  | 'page.edit'
  | 'page.create'
  | 'page.restrict'
  | 'project.share'
  | 'project.manage';

export interface PrincipalRef {
  type: 'user' | 'group';
  id: string;
}

export interface Subject {
  userId: string;
  workspaceRole: WorkspaceRole;
  groupIds: readonly string[];
}

export interface Grant {
  principal: PrincipalRef;
  role: ProjectRole;
}

/** Restriction posée sur une page: seuls les principaux listés gardent le droit. */
export interface Restriction {
  pageId: string;
  kind: RestrictionKind;
  principal: PrincipalRef;
}

export const PROJECT_ROLES: readonly ProjectRole[] = ['reader', 'commenter', 'editor', 'admin'];

const RANK: Record<ProjectRole, number> = { reader: 1, commenter: 2, editor: 3, admin: 4 };

export const ROLE_ACTIONS: Record<ProjectRole, readonly Action[]> = {
  reader: ['page.read'],
  commenter: ['page.read', 'page.comment'],
  editor: ['page.read', 'page.comment', 'page.edit', 'page.create', 'page.restrict'],
  admin: ['page.read', 'page.comment', 'page.edit', 'page.create', 'page.restrict', 'project.share', 'project.manage'],
};

export function minRole(a: ProjectRole, b: ProjectRole): ProjectRole {
  return RANK[a] <= RANK[b] ? a : b;
}

export function maxRole(a: ProjectRole, b: ProjectRole): ProjectRole {
  return RANK[a] >= RANK[b] ? a : b;
}

export function matches(subject: Subject, principal: PrincipalRef): boolean {
  return principal.type === 'user' ? principal.id === subject.userId : subject.groupIds.includes(principal.id);
}

/**
 * Un invité de l'espace (prestataire) ne dépasse jamais éditeur, même par un
 * groupe: administrer un volume, c'est pouvoir l'ouvrir à d'autres.
 */
export const GUEST_CEILING: ProjectRole = 'editor';

/** Rôle du sujet dans un projet, ou null s'il n'y a aucun accès. */
export function projectRole(subject: Subject, grants: readonly Grant[]): ProjectRole | null {
  if (subject.workspaceRole === 'owner' || subject.workspaceRole === 'admin') return 'admin';
  let role: ProjectRole | null = null;
  for (const grant of grants) {
    if (!matches(subject, grant.principal)) continue;
    role = role ? maxRole(role, grant.role) : grant.role;
  }
  return role && subject.workspaceRole === 'guest' ? minRole(role, GUEST_CEILING) : role;
}

/**
 * Rôle effectif sur une page.
 *
 * `restrictions` contient les restrictions de la page ET de tous ses ancêtres.
 * Pour chaque (page, type) restreint, le sujet doit figurer dans la liste:
 * sinon une restriction `view` retire tout accès, et une restriction `edit`
 * plafonne le rôle à `commenter`. Le propriétaire de l'espace n'est pas concerné.
 */
export function pageRole(
  subject: Subject,
  grants: readonly Grant[],
  restrictions: readonly Restriction[],
): ProjectRole | null {
  const base = projectRole(subject, grants);
  if (!base) return null;
  if (subject.workspaceRole === 'owner') return base;

  const allowed = new Map<string, boolean>();
  for (const r of restrictions) {
    const key = `${r.pageId}:${r.kind}`;
    allowed.set(key, (allowed.get(key) ?? false) || matches(subject, r.principal));
  }

  let role: ProjectRole = base;
  for (const [key, ok] of allowed) {
    if (ok) continue;
    if (key.endsWith(':view')) return null;
    role = minRole(role, 'commenter');
  }
  return role;
}

export function can(role: ProjectRole | null, action: Action): boolean {
  return role !== null && ROLE_ACTIONS[role].includes(action);
}

/* ---------- Comptes de l'espace ---------- */

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

/** Propriétaires et admins gèrent les comptes; personne d'autre. */
export function canManageAccounts(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** Ranger la bibliothèque (créer, renommer, ordonner, supprimer des rayons): propriétaires et admins de l'espace. */
export function canArrangeLibrary(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** Rôles qu'un acteur peut attribuer: seul un propriétaire fait d'autres propriétaires. */
export function assignableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  if (actor === 'owner') return [...WORKSPACE_ROLES];
  if (actor === 'admin') return ['admin', 'member', 'guest'];
  return [];
}

/**
 * Peut-on changer le rôle de ce compte, le désactiver ou réinitialiser son mot de passe ?
 * Jamais sur soi-même (on ne se verrouille pas dehors), et un admin ne touche pas aux propriétaires.
 * La règle « il reste au moins un propriétaire actif » demande la base: elle est vérifiée par l'API.
 */
export function canManageAccount(actor: { userId: string; role: WorkspaceRole }, target: { userId: string; role: WorkspaceRole }): boolean {
  if (!canManageAccounts(actor.role) || actor.userId === target.userId) return false;
  return actor.role === 'owner' || target.role !== 'owner';
}

/* ---------- Commentaires ---------- */

/**
 * Supprimer un commentaire: son auteur tant qu'il peut encore lire la page,
 * ou un admin du volume (modération).
 */
export function canDeleteComment(role: ProjectRole | null, isAuthor: boolean): boolean {
  if (role === null) return false;
  return isAuthor || can(role, 'project.manage');
}

export type NotificationKind = 'mention' | 'reply';

/**
 * Qui prévenir d'un nouveau message dans un fil: les personnes citées, puis les
 * autres participants du fil. Jamais l'auteur, jamais deux fois, et seulement
 * qui peut lire la page: une notification montre un extrait du commentaire.
 */
export function commentRecipients(
  event: { authorId: string; mentioned: readonly string[]; participants: readonly string[] },
  canRead: (userId: string) => boolean,
): { userId: string; kind: NotificationKind }[] {
  const seen = new Set([event.authorId]);
  const out: { userId: string; kind: NotificationKind }[] = [];
  const add = (userId: string, kind: NotificationKind) => {
    if (seen.has(userId)) return;
    seen.add(userId);
    if (canRead(userId)) out.push({ userId, kind });
  };
  for (const id of event.mentioned) add(id, 'mention');
  for (const id of event.participants) add(id, 'reply');
  return out;
}

/**
 * Un volume archivé se lit encore mais ne s'écrit plus: tous y deviennent
 * lecteurs, admins compris. Le désarchiver se décide sur le rôle d'origine.
 */
export function archivedRole(role: ProjectRole | null, archived: boolean): ProjectRole | null {
  return role && archived ? minRole(role, 'reader') : role;
}

/** Supprimer un volume pour de bon: propriétaires et admins de l'espace seulement. */
export function canDeleteProject(subject: Subject): boolean {
  return subject.workspaceRole === 'owner' || subject.workspaceRole === 'admin';
}

/** Les invités ne créent pas de projet; les membres, si l'espace l'autorise. */
export function canCreateProject(subject: Subject, membersMayCreate = true): boolean {
  if (subject.workspaceRole === 'owner' || subject.workspaceRole === 'admin') return true;
  return subject.workspaceRole === 'member' && membersMayCreate;
}
