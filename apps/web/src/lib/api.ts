import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { JSONContent } from '@andal/editor';
import type { WorkspaceRole } from '@andal/authz';
import type { Role } from '@andal/ui';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    // Les erreurs de l'API portent un message en français, affichable tel quel.
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Corps absent ou non JSON: on garde le statut.
    }
    throw new ApiError(response.status, message);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export type Cloth = 'paiements' | 'identite' | 'donnees' | 'mobile' | 'plateforme' | 'design';

export interface Me {
  user: { id: string; name: string; initials: string; color: string; email: string; username: string | null; workspaceRole: string; hasPassword: boolean };
  auth: { method: 'password' | 'oidc' };
}

/** Modes de connexion proposés par ce serveur. */
export interface AuthConfig {
  password: boolean;
  /** « Mot de passe oublié » disponible (connexion par mot de passe et envoi d'email actifs). */
  passwordReset: boolean;
  oidc: { label: string } | null;
}

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  description: string | null;
  cloth: Cloth;
  volumeNumber: number;
  role: Role;
  pageCount: number;
  firstPageId: string | null;
  /** Sur l'étagère de la personne connectée. */
  pinned: boolean;
  /** Le rayon de la bibliothèque, ou null: hors rayon. */
  rayonId: string | null;
  /** Dernière modification d'une page qu'elle peut lire. */
  updatedAt: string;
}

export interface TreePage {
  id: string;
  parentId: string | null;
  number: string;
  title: string;
  role: Role;
  restricted: boolean;
  updatedAt: string;
}

export interface Tree {
  project: {
    id: string;
    slug: string;
    name: string;
    shortName: string;
    description: string | null;
    cloth: Cloth;
    volumeNumber: number;
    rayonId: string | null;
    /** Rôle effectif: lecture seule pour tous quand le volume est archivé. */
    role: Role;
    archived: boolean;
    /** Admin du volume (rôle d'origine): réglages, archivage. */
    canManage: boolean;
    /** Admin de l'espace: suppression d'un volume archivé. */
    canDelete: boolean;
  };
  pages: TreePage[];
}

export interface PrincipalView {
  type: 'user' | 'group';
  id: string;
  name: string;
  members: number | null;
  you: boolean;
  initials: string | null;
  color: string | null;
  /** Invité de l'espace: au plus éditeur d'un volume. */
  guest: boolean;
}

/** Personne active ou groupe, proposé pour un volume ou une restriction. */
export interface DirectoryEntry extends PrincipalView {
  detail: string;
}

export interface AccessSummary {
  write: PrincipalView[];
  comment: PrincipalView[];
  read: PrincipalView[];
  inherited: boolean;
  restrictions: { pageId: string; kind: 'view' | 'edit'; onThisPage: boolean; principal: PrincipalView }[];
}

export interface PageRef {
  id: string;
  number: string;
  title: string;
}

/** Le panneau Partager: accès au volume, restrictions de la page, annuaire pour qui peut modifier. */
export interface Sharing extends AccessSummary {
  projectId: string;
  project: { name: string; shortName: string };
  role: Role;
  canShare: boolean;
  canRestrict: boolean;
  grants: { principal: PrincipalView; role: Role }[];
  pageRestrictions: { view: PrincipalView[]; edit: PrincipalView[] };
  inheritedRestrictions: { page: PageRef; kind: 'view' | 'edit'; principals: PrincipalView[] }[];
  directory: DirectoryEntry[] | null;
}

export interface PageDetail {
  id: string;
  title: string;
  summary: string | null;
  number: string;
  content: JSONContent;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  role: Role;
  project: { slug: string; name: string; shortName: string; cloth: Cloth; volumeNumber: number; pageCount: number };
  breadcrumb: PageRef[];
  numbering: { chapter: string; figureOffset: number; listingOffset: number };
  access: AccessSummary;
  prev: PageRef | null;
  next: PageRef | null;
}

export interface ThreadComment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; initials: string; color: string };
  /** Personnes citées (@identifiant) et prévenues. */
  mentions: { id: string; name: string; username: string; you: boolean }[];
  canDelete: boolean;
}

/** Quelqu'un qu'on peut citer sur une page: il peut la lire. */
export interface Mentionable {
  id: string;
  name: string;
  username: string;
  initials: string;
  color: string;
  you: boolean;
}

/** Réponse d'un nouveau commentaire: les personnes citées qui ne lisent pas la page n'ont pas été prévenues. */
export interface Posted {
  id: string;
  unreachable: string[];
}

export interface NotificationItem {
  id: string;
  kind: 'mention' | 'reply' | 'resolved';
  createdAt: string;
  read: boolean;
  actor: { name: string; initials: string; color: string } | null;
  page: { id: string; title: string; slug: string; shortName: string; cloth: Cloth };
  threadId: string;
  excerpt: string | null;
}

export interface Notifications {
  unread: number;
  items: NotificationItem[];
  email: { available: boolean; enabled: boolean };
}

export interface Thread {
  id: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Droit de répondre, résoudre et rouvrir (rôle commentateur ou plus). */
  canReply: boolean;
  comments: ThreadComment[];
}

/* ---------- Administration des comptes ---------- */

export interface AdminUser {
  id: string;
  name: string;
  initials: string;
  color: string;
  email: string;
  username: string | null;
  role: WorkspaceRole;
  disabledAt: string | null;
  lastLoginAt: string | null;
  hasPassword: boolean;
  sso: boolean;
  you: boolean;
  manageable: boolean;
}

export interface AdminInvitation {
  id: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  groups: string[];
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  manageable: boolean;
}

export interface AccountsOverview {
  users: AdminUser[];
  invitations: AdminInvitation[];
  assignableRoles: WorkspaceRole[];
  groups: { id: string; name: string }[];
  /** Les emails partent: sinon, l'admin transmet les liens lui-même. */
  mail: boolean;
  passwordLogin: boolean;
}

/** Résultat d'une invitation ou d'une réinitialisation: email parti, et/ou lien à transmettre. */
export interface LinkResult {
  emailed: boolean;
  link: string | null;
}

/** Ce que dit un lien reçu par email, avant de l'utiliser. */
export interface LinkInfo {
  kind: 'invite' | 'reset';
  email: string;
  name: string | null;
  role: WorkspaceRole | null;
  /** Groupes rejoints à l'inscription. */
  groups: string[];
  workspace: string;
  suggestedUsername: string;
  passwordLogin: boolean;
  expiresAt: string;
}

export interface VersionAuthor {
  id: string;
  name: string;
  initials: string;
  color: string;
}

/** Une version de l'historique: une séance de travail, avec ceux qui y ont contribué. */
export interface VersionSummary {
  id: string;
  version: number;
  title: string;
  current: boolean;
  createdAt: string;
  updatedAt: string;
  authors: VersionAuthor[];
}

export interface VersionDetail {
  id: string;
  version: number;
  title: string;
  content: JSONContent;
  updatedAt: string;
  authors: VersionAuthor[];
}

/** Une branche à la corbeille d'un volume: la page supprimée et ses sous-pages, restaurées ensemble. */
export interface TrashEntry {
  id: string;
  title: string;
  deletedAt: string;
  deletedBy: string | null;
  /** Date de la suppression définitive automatique. */
  purgeAt: string;
  /** Admin du volume: peut supprimer définitivement sans attendre. */
  canPurge: boolean;
  subpages: number;
  parent: { title: string; deleted: boolean } | null;
}

export interface GroupView {
  id: string;
  name: string;
  members: { id: string; name: string; initials: string; color: string; email: string; disabled: boolean }[];
  volumes: { id: string; shortName: string; cloth: Cloth; volumeNumber: number; role: Role }[];
  restrictedPages: number;
}

export interface GroupsOverview {
  groups: GroupView[];
  users: { id: string; name: string; initials: string; color: string; email: string }[];
}

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  number: string;
  project: { slug: string; shortName: string; cloth: Cloth };
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api<ProjectSummary[]>('/projects') });
/** Un rayon de la bibliothèque: un domaine qui regroupe des volumes. */
export interface Rayon {
  id: string;
  name: string;
}

export interface ArchivedVolume {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  cloth: Cloth;
  volumeNumber: number;
  archivedAt: string;
  archivedBy: string | null;
  pageCount: number;
  canDelete: boolean;
}

export const useRayons = () => useQuery({ queryKey: ['rayons'], queryFn: () => api<Rayon[]>('/rayons') });
export const useArchivedVolumes = (enabled: boolean) => useQuery({ queryKey: ['projects', 'archived'], queryFn: () => api<ArchivedVolume[]>('/projects/archived'), enabled });
export const useTree = (slug: string) => useQuery({ queryKey: ['tree', slug], queryFn: () => api<Tree>(`/projects/${slug}/tree`) });
export const usePage = (id: string) => useQuery({ queryKey: ['page', id], queryFn: () => api<PageDetail>(`/pages/${id}`) });
export const useThreads = (id: string) => useQuery({ queryKey: ['threads', id], queryFn: () => api<Thread[]>(`/pages/${id}/comments`) });
export const useSharing = (id: string, enabled: boolean) => useQuery({ queryKey: ['sharing', id], queryFn: () => api<Sharing>(`/pages/${id}/sharing`), enabled });
export const useMentionable = (pageId: string, enabled: boolean) =>
  useQuery({ queryKey: ['mentionable', pageId], queryFn: () => api<Mentionable[]>(`/pages/${pageId}/mentionable`), enabled, staleTime: 60_000 });
/** Relue toutes les minutes, au retour sur l'onglet, et aussitôt que le serveur collab signale du nouveau. */
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api<Notifications>('/notifications'), refetchInterval: 60_000 });
export const useVersions = (pageId: string, enabled: boolean) => useQuery({ queryKey: ['versions', pageId], queryFn: () => api<VersionSummary[]>(`/pages/${pageId}/versions`), enabled });
export const useVersion = (pageId: string, version: number | null) =>
  useQuery({ queryKey: ['versions', pageId, version], queryFn: () => api<VersionDetail>(`/pages/${pageId}/versions/${version}`), enabled: version !== null });
export const useTrash = (projectId: string, enabled: boolean) => useQuery({ queryKey: ['trash', projectId], queryFn: () => api<TrashEntry[]>(`/projects/${projectId}/trash`), enabled });
export const useGroups = () => useQuery({ queryKey: ['admin', 'groups'], queryFn: () => api<GroupsOverview>('/admin/groups') });
export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: () => api<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 1,
    placeholderData: keepPreviousData,
  });
export const useAccounts = () => useQuery({ queryKey: ['admin', 'accounts'], queryFn: () => api<AccountsOverview>('/admin/accounts') });
export const useLinkInfo = (token: string) => useQuery({ queryKey: ['link', token], queryFn: () => api<LinkInfo>(`/auth/links/${encodeURIComponent(token)}`), retry: false });
export const useAuthConfig = () => useQuery({ queryKey: ['auth-config'], queryFn: () => api<AuthConfig>('/auth/config'), staleTime: Infinity });

/** Une adresse de retour n'est suivie que si elle reste dans l'application. */
export function localPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login') ? value : undefined;
}

export function canEdit(role: Role): boolean {
  return role === 'editor' || role === 'admin';
}

export function canComment(role: Role): boolean {
  return role !== 'reader';
}

/** Message d'erreur lisible pour une action qui a échoué. */
export function errorMessage(error: unknown, fallback = 'L’action a échoué. Réessayez dans un instant.'): string {
  return error instanceof ApiError && error.status < 500 ? error.message : fallback;
}
