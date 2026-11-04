import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ApiOperation, JSONContent } from '@andal/editor';
import type { WorkspaceRole } from '@andal/authz';
import type { Role } from '@andal/ui';
import { locale, t } from './i18n';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    // Un FormData (envoi de fichier) fixe lui-même son type et sa frontière multipart.
    // Les messages d'erreur de l'API arrivent dans la langue de l'interface.
    headers: { accept: 'application/json', 'accept-language': locale, ...(typeof init?.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    // Le message d'erreur de l'API est rédigé pour être affiché tel quel.
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

/**
 * Télécharge un export (Markdown, PDF, archive): le fichier arrive par fetch,
 * pour qu'une erreur s'affiche dans l'interface au lieu d'ouvrir une page JSON.
 */
export async function download(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'accept-language': locale } });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Corps absent ou non JSON: on garde le statut.
    }
    throw new ApiError(response.status, message);
  }
  const header = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface UploadedFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  image: boolean;
}

/** Envoie un fichier sur une page (droit d'écriture); il reste lisible par qui lit la page. */
export function uploadFile(pageId: string, file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append('file', file, file.name);
  return api<UploadedFile>(`/pages/${pageId}/files`, { method: 'POST', body: form });
}

export interface SpecSummary {
  id: string;
  name: string;
  title: string;
  /** info.version de la dernière publication (« 2.3 »). */
  label: string;
  sequence: number;
  operationCount: number;
  updatedAt: string;
}

export interface SpecList {
  canPublish: boolean;
  specs: SpecSummary[];
}

export interface SpecOperationRef {
  key: string;
  method: ApiOperation['method'];
  path: string;
  summary: string;
  tags: string[];
}

export interface SpecDetail {
  id: string;
  name: string;
  title: string;
  project: { id: string; slug: string; name: string; shortName: string };
  versions: { sequence: number; label: string; createdAt: string; author: string | null }[];
  canPublish: boolean;
  canDelete: boolean;
}

export interface LiveOperation {
  operation: ApiOperation;
  specName: string;
  title: string;
  sequence: number;
  label: string;
}

export interface PublishedSpec {
  id: string;
  name: string;
  title: string;
  sequence: number;
  label: string;
  /** Même contenu que la dernière version: rien n'a été ajouté. */
  unchanged: boolean;
  operationCount: number;
}

/** Publie une spec OpenAPI (YAML ou JSON) dans un volume; même nom, nouvelle version. */
export function publishSpec(projectId: string, file: File, name?: string): Promise<PublishedSpec> {
  const form = new FormData();
  form.append('file', file, file.name);
  return api<PublishedSpec>(`/projects/${projectId}/specs${name ? `?name=${encodeURIComponent(name)}` : ''}`, { method: 'POST', body: form });
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  lastUsedAt: string | null;
}

export type WebhookKind = 'generic' | 'slack' | 'teams';

export interface Webhook {
  id: string;
  name: string;
  url: string;
  kind: WebhookKind;
  events: string[];
  active: boolean;
  /** Clé HMAC (format générique seulement). */
  secret: string | null;
  project: { id: string; name: string } | null;
  createdAt: string;
  lastDelivery: { status: number | null; error: string | null; at: string } | null;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  attempt: number;
  status: number | null;
  error: string | null;
  durationMs: number | null;
  at: string;
}

export type Unfurl =
  | { kind: 'github'; type: 'issue' | 'pull'; repo: string; number: number; title: string; state: 'open' | 'closed' | 'merged' | 'draft'; author: string | null; url: string }
  | { kind: 'jira'; key: string; summary: string; status: string; category: 'new' | 'indeterminate' | 'done'; type: string | null; url: string };

export type Cloth = 'paiements' | 'identite' | 'donnees' | 'mobile' | 'plateforme' | 'design';

export interface Me {
  user: { id: string; name: string; initials: string; color: string; email: string; username: string | null; workspaceRole: string; hasPassword: boolean; mfa: boolean; locale: 'fr' | 'en' };
  auth: { method: 'password' | 'oidc' };
  /** Ce que ce serveur propose: export PDF (Gotenberg), liens publics, import d'archives (stockage S3). */
  features: { pdf: boolean; publicLinks: boolean; imports: boolean; importMaxMb: number };
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
  project: { id: string; slug: string; name: string; shortName: string; cloth: Cloth; volumeNumber: number; pageCount: number };
  breadcrumb: PageRef[];
  numbering: { chapter: string; figureOffset: number; listingOffset: number };
  access: AccessSummary;
  prev: PageRef | null;
  next: PageRef | null;
  /** Pages lisibles qui citent celle-ci. */
  backlinks: LinkedPage[];
  /** Page tenue par un dépôt Git: d'où elle vient, où la modifier. */
  git: { repo: string; file: string; url: string | null; syncedAt: string | null } | null;
}

/** Une page d'un volume, avec de quoi l'afficher hors de son sommaire (liens, rétroliens). */
export interface LinkedPage {
  id: string;
  title: string;
  number: string;
  project: { slug: string; shortName: string; cloth: Cloth };
}

/** Aperçu d'une page au survol d'un lien. */
export interface PagePreview {
  id: string;
  title: string;
  number: string;
  summary: string | null;
  excerpt: string;
  updatedAt: string;
  project: { slug: string; name: string; shortName: string; cloth: Cloth };
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
  mfa: boolean;
  scim: boolean;
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
  /** Qui tient le groupe: l'administration, le SSO ou l'annuaire SCIM. */
  source: 'local' | 'sso' | 'scim';
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

export interface PublicLink {
  id: string;
  token: string;
  url: string;
  /** null: tout le volume. */
  page: { id: string; title: string } | null;
  subpages: boolean;
  createdAt: string;
  createdBy: string | null;
}

/** Les liens publics qui couvrent une page: le sien, celui d'une parente avec ses sous-pages, celui du volume. */
export interface PublicLinks {
  enabled: boolean;
  canManage: boolean;
  /** Restreinte en lecture (elle ou une parente): jamais publique. */
  restricted: boolean;
  links: PublicLink[];
}

/** Un import d'archive, fait par le worker. */
export interface ImportState {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  source: 'markdown' | 'notion' | 'confluence' | 'html' | null;
  fileName: string;
  pages: number;
  files: number;
  firstPageId: string | null;
  warnings: string[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export const usePublicLinks = (pageId: string, enabled: boolean) => useQuery({ queryKey: ['public-links', pageId], queryFn: () => api<PublicLinks>(`/pages/${pageId}/public-links`), enabled });

/** Un partage public, lu sans compte. */
export interface PublicShare {
  title: string;
  kind: 'page' | 'volume';
  project: { name: string; shortName: string; cloth: Cloth; volumeNumber: number };
  root: string;
  pages: { id: string; parentId: string | null; number: string; title: string }[];
}

export interface PublicPage {
  id: string;
  title: string;
  summary: string | null;
  number: string;
  updatedAt: string;
  content: JSONContent;
  numbering: { chapter: string; figureOffset: number; listingOffset: number };
  prev: { id: string; number: string; title: string } | null;
  next: { id: string; number: string; title: string } | null;
}

export const usePublicShare = (token: string) => useQuery({ queryKey: ['public', token], queryFn: () => api<PublicShare>(`/public/${token}`), retry: false });
export const usePublicPage = (token: string, pageId: string) => useQuery({ queryKey: ['public', token, pageId], queryFn: () => api<PublicPage>(`/public/${token}/pages/${pageId}`), retry: false });
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
export const usePageLookup = (q: string, volume: string) =>
  useQuery({
    queryKey: ['lookup', q, volume],
    queryFn: () => api<LinkedPage[]>(`/pages/lookup?q=${encodeURIComponent(q)}&volume=${encodeURIComponent(volume)}`),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });
export const usePagePreview = (id: string | null) =>
  useQuery({ queryKey: ['preview', id], queryFn: () => api<PagePreview>(`/pages/${id}/preview`), enabled: id !== null, retry: false, staleTime: 30_000 });
export const useProjectSpecs = (projectId: string | null) =>
  useQuery({ queryKey: ['specs', 'project', projectId], queryFn: () => api<SpecList>(`/projects/${projectId}/specs`), enabled: projectId !== null });
export const useSpec = (id: string) => useQuery({ queryKey: ['specs', id], queryFn: () => api<SpecDetail>(`/specs/${id}`) });
export const useSpecDocument = (id: string, version?: number) =>
  useQuery({ queryKey: ['specs', id, 'document', version ?? 'latest'], queryFn: () => api<Record<string, unknown>>(`/specs/${id}/document${version ? `?version=${version}` : ''}`), staleTime: 60_000 });
export const useSpecOperations = (id: string | null) =>
  useQuery({ queryKey: ['specs', id, 'operations'], queryFn: () => api<SpecOperationRef[]>(`/specs/${id}/operations`), enabled: id !== null });
export const useSpecOperation = (id: string | null, key: string | null) =>
  useQuery({
    queryKey: ['specs', id, 'operation', key],
    queryFn: () => api<LiveOperation>(`/specs/${id}/operation?key=${encodeURIComponent(key ?? '')}`),
    enabled: id !== null && key !== null,
    retry: false,
    staleTime: 60_000,
  });
/* ---------- Sécurité du compte, journal, annuaire ---------- */

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  /** Faux pour un compte SSO: la double authentification se règle chez le fournisseur. */
  available: boolean;
}

export interface OpenSession {
  id: string;
  current: boolean;
  method: 'password' | 'oidc' | 'token';
  mfa: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  device: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  actor: { id: string; name: string; initials: string; color: string } | null;
  target: { type: string; id: string | null; label: string | null; href: string | null };
  ip: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditPage {
  events: AuditEvent[];
  next: string | null;
  people: { id: string; name: string }[];
  actions: string[] | null;
}

export interface ScimState {
  baseUrl: string;
  token: { prefix: string; createdAt: string; createdBy: string | null; lastUsedAt: string | null } | null;
  provisioned: { users: number; groups: number };
  sso: { groupsClaim: string | null } | null;
}

export const useMfa = () => useQuery({ queryKey: ['me', 'mfa'], queryFn: () => api<MfaStatus>('/me/mfa') });
export const useSessions = () => useQuery({ queryKey: ['me', 'sessions'], queryFn: () => api<OpenSession[]>('/me/sessions') });
export const useScim = () => useQuery({ queryKey: ['admin', 'scim'], queryFn: () => api<ScimState>('/admin/scim') });

export const useTokens = () => useQuery({ queryKey: ['me', 'tokens'], queryFn: () => api<ApiToken[]>('/me/tokens') });
export const useWebhooks = () => useQuery({ queryKey: ['admin', 'webhooks'], queryFn: () => api<{ events: string[]; webhooks: Webhook[] }>('/admin/webhooks') });
export const useWebhookDeliveries = (id: string | null) =>
  useQuery({ queryKey: ['admin', 'webhooks', id, 'deliveries'], queryFn: () => api<WebhookDelivery[]>(`/admin/webhooks/${id}/deliveries`), enabled: id !== null, refetchInterval: 5000 });
export const useUnfurl = (url: string | null) =>
  useQuery({ queryKey: ['unfurl', url], queryFn: () => api<Unfurl>(`/unfurl?url=${encodeURIComponent(url ?? '')}`), enabled: url !== null, retry: false, staleTime: 300_000 });
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
export function errorMessage(error: unknown, fallback = t('L’action a échoué. Réessayez dans un instant.')): string {
  return error instanceof ApiError && error.status < 500 ? error.message : fallback;
}
