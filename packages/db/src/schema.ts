import type { ProjectRole, RestrictionKind, WorkspaceRole } from '@andal/authz';
import type { JSONContent } from '@andal/editor';
import type { ColumnType, Generated, Selectable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T> = ColumnType<T, T | string, T | string>;

export type Cloth = 'paiements' | 'identite' | 'donnees' | 'mobile' | 'plateforme' | 'design';
export type PrincipalType = 'user' | 'group';

export interface WorkspacesTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  workspace_id: string;
  email: string;
  name: string;
  initials: string;
  color: string;
  workspace_role: WorkspaceRole;
  /** Identifiant de connexion, en plus de l'email. Unique par espace, sans tenir compte de la casse. */
  username: string | null;
  /** Empreinte Argon2id. Nulle pour un compte qui ne se connecte que par SSO. */
  password_hash: string | null;
  password_changed_at: Date | null;
  /** Identité OIDC liée (émetteur + sujet), quand le SSO est activé. */
  oidc_issuer: string | null;
  oidc_subject: string | null;
  /** Compte désactivé: plus de connexion, sessions fermées. On ne supprime pas, pour garder l'historique. */
  disabled_at: Date | null;
  last_login_at: Date | null;
  /** Recevoir aussi par email les notifications non lues. */
  notify_email: Generated<boolean>;
  created_at: Generated<Date>;
}

export type AccountTokenKind = 'invite' | 'reset';

/** Jetons à usage unique envoyés par lien: invitation ou réinitialisation de mot de passe. */
export interface AccountTokensTable {
  id: Generated<string>;
  workspace_id: string;
  kind: AccountTokenKind;
  /** Empreinte SHA-256: le jeton lui-même n'est jamais stocké. */
  token_hash: string;
  email: string;
  /** Invitation: nom proposé et rôle attribué. */
  name: string | null;
  role: WorkspaceRole | null;
  /** Invitation: groupes rejoints à l'inscription, donc les volumes ouverts d'emblée. */
  group_ids: ColumnType<string[], string | undefined, string>;
  /** Réinitialisation: le compte visé. */
  user_id: string | null;
  created_by: string | null;
  expires_at: Date;
  used_at: Date | null;
  created_at: Generated<Date>;
}

export interface GroupsTable {
  id: Generated<string>;
  workspace_id: string;
  name: string;
  icon: Generated<string>;
}

export interface GroupMembersTable {
  group_id: string;
  user_id: string;
}

/** Un rayon de la bibliothèque: regroupe des volumes par domaine. Un seul niveau, ordonné. */
export interface RayonsTable {
  id: Generated<string>;
  workspace_id: string;
  name: string;
  position: Generated<number>;
  created_at: Generated<Date>;
}

export interface ProjectsTable {
  id: Generated<string>;
  workspace_id: string;
  slug: string;
  name: string;
  short_name: string;
  description: string | null;
  cloth: Cloth;
  volume_number: number;
  created_at: Generated<Date>;
  /** Le rayon de la bibliothèque où le volume est rangé; aucun, il est « hors rayon ». */
  rayon_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Volume archivé: absent de l'étagère et de la recherche, lisible mais plus modifiable. */
  archived_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  archived_by: ColumnType<string | null, string | null | undefined, string | null>;
}

/** Les volumes qu'une personne garde sur son étagère. Les autres restent dans la bibliothèque. */
export interface ProjectPinsTable {
  user_id: string;
  project_id: string;
  created_at: Generated<Date>;
}

export interface ProjectMembersTable {
  project_id: string;
  principal_type: PrincipalType;
  principal_id: string;
  role: ProjectRole;
}

export interface PagesTable {
  id: Generated<string>;
  project_id: string;
  parent_id: string | null;
  /** ltree: un libellé par niveau, l'id de la page sans tirets. */
  path: string;
  position: number;
  title: string;
  summary: string | null;
  content: Json<JSONContent>;
  ydoc: Buffer | null;
  text_content: Generated<string>;
  version: Generated<number>;
  updated_by: string | null;
  updated_at: Generated<Date>;
  created_at: Generated<Date>;
  /** Corbeille: la page et ses sous-pages, supprimées ensemble, partagent la même date. */
  deleted_at: Date | null;
  deleted_by: string | null;
  /** Page tenue par la synchro Git du volume: son fichier dans le dépôt. */
  git_sync_id: ColumnType<string | null, string | null | undefined, string | null>;
  git_path: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * Historique d'une page: un instantané par version. Une version regroupe une
 * séance de travail (voir versions.ts), avec tous ceux qui y ont contribué.
 */
export interface PageVersionsTable {
  id: Generated<string>;
  page_id: string;
  version: number;
  title: string;
  content: Json<JSONContent>;
  /** Comptes qui ont contribué à cette version, dans l'ordre d'arrivée. */
  authors: ColumnType<string[], string, string>;
  created_at: ColumnType<Date, Date | undefined, Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface PageRestrictionsTable {
  page_id: string;
  kind: RestrictionKind;
  principal_type: PrincipalType;
  principal_id: string;
}

export interface CommentThreadsTable {
  id: Generated<string>;
  page_id: string;
  created_by: string | null;
  resolved_at: Timestamp | null;
  resolved_by: string | null;
  created_at: Generated<Date>;
}

export interface CommentsTable {
  id: Generated<string>;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: Generated<Date>;
}

/** Personnes citées (@identifiant) dans un commentaire, résolues à l'envoi. */
export interface CommentMentionsTable {
  comment_id: string;
  user_id: string;
}

export type NotificationKind = 'mention' | 'reply' | 'resolved';

/**
 * Ce qui attend quelqu'un: une citation, une réponse dans un fil suivi, un fil
 * résolu. Pas d'extrait stocké: il est relu au moment de l'afficher, après
 * avoir revérifié que la page est toujours lisible.
 */
export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  kind: NotificationKind;
  actor_id: string | null;
  page_id: string;
  thread_id: string;
  comment_id: string | null;
  created_at: Generated<Date>;
  read_at: Date | null;
  emailed_at: Date | null;
}

export interface AuditEventsTable {
  id: Generated<string>;
  workspace_id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  ip: string | null;
  metadata: Json<Record<string, unknown>>;
  created_at: Generated<Date>;
}

/** Fichier envoyé sur une page: qui lit la page lit le fichier. */
export interface AttachmentsTable {
  id: Generated<string>;
  page_id: string;
  name: string;
  content_type: string;
  size: number;
  storage_key: string;
  created_by: string | null;
  created_at: Generated<Date>;
}

/** Objets à effacer du stockage, remplie par un trigger à la suppression d'une pièce jointe. */
export interface StorageTrashTable {
  storage_key: string;
  created_at: Generated<Date>;
}

/** Lien d'une page vers une autre, recalculé à chaque enregistrement (rétroliens). */
export interface PageLinksTable {
  source_id: string;
  target_id: string;
}

/** Spec OpenAPI d'un volume, publiée par la CI ou envoyée à la main; chaque publication différente ajoute une version. */
export interface ApiSpecsTable {
  id: Generated<string>;
  project_id: string;
  /** Nom court, unique dans le volume (« paiements »): la CI publie toujours sous le même. */
  name: string;
  /** info.title de la dernière version. */
  title: string;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ApiSpecVersionsTable {
  id: Generated<string>;
  spec_id: string;
  /** 1, 2, 3… dans l'ordre de publication. */
  sequence: number;
  /** info.version du document (« 2.3 »), tel quel. */
  label: string;
  /** Le document analysé (YAML ou JSON d'origine). */
  content: Json<Record<string, unknown>>;
  /** SHA-256 du document normalisé: republier la même spec ne crée pas de version. */
  content_hash: string;
  created_by: string | null;
  created_at: Generated<Date>;
}

export type TokenScope = 'read' | 'write';

/** Jeton d'API personnel: il agit au nom de son auteur, avec ses droits, en lecture seule ou non. */
export interface ApiTokensTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  /** Empreinte SHA-256: le jeton n'est montré qu'une fois, à sa création. */
  token_hash: string;
  /** Début du jeton (« andal_Xy12… »), pour le reconnaître dans la liste. */
  prefix: string;
  scope: TokenScope;
  expires_at: Date | null;
  last_used_at: Date | null;
  last_used_ip: string | null;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export type WebhookKind = 'generic' | 'slack' | 'teams';
export type WebhookEvent = 'page.created' | 'page.updated' | 'page.deleted' | 'comment.created' | 'spec.published';

/** Abonnement d'une URL aux événements de l'espace (ou d'un seul volume). */
export interface WebhooksTable {
  id: Generated<string>;
  workspace_id: string;
  /** Null: tous les volumes de l'espace. */
  project_id: string | null;
  name: string;
  url: string;
  kind: WebhookKind;
  /** Clé HMAC de la signature (format générique). */
  secret: string;
  events: ColumnType<WebhookEvent[], WebhookEvent[] | string, WebhookEvent[] | string>;
  active: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Date>;
}

/** Une tentative d'envoi, pour le journal de l'intégration. */
export interface WebhookDeliveriesTable {
  id: Generated<string>;
  webhook_id: string;
  event: string;
  attempt: number;
  /** Code HTTP reçu; null si la requête n'a pas abouti. */
  status: number | null;
  error: string | null;
  duration_ms: number | null;
  created_at: Generated<Date>;
}

/** Synchro à sens unique d'un dossier de dépôt Git vers un volume (docs-as-code). */
export interface GitSyncsTable {
  id: Generated<string>;
  project_id: string;
  /** https://… (le seul protocole accepté). */
  repo_url: string;
  branch: Generated<string>;
  /** Dossier du dépôt (« docs »); vide: la racine. */
  path: Generated<string>;
  /** Jeton d'accès en lecture pour un dépôt privé; jamais renvoyé par l'API. */
  access_token: string | null;
  /** Secret du webhook « push » (GitHub, GitLab, Gitea). */
  webhook_secret: string;
  enabled: Generated<boolean>;
  last_commit: string | null;
  last_synced_at: Date | null;
  last_error: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
}

/** Image du dépôt déjà envoyée: réutilisée tant que son contenu ne change pas. */
export interface GitSyncAssetsTable {
  sync_id: string;
  path: string;
  sha256: string;
  attachment_id: string;
}

export type AiProvider = 'anthropic' | 'openai';

/** Assistant de questions-réponses de l'espace: fournisseur et modèle choisis par les admins. */
export interface AiSettingsTable {
  workspace_id: string;
  enabled: Generated<boolean>;
  /** 'openai': toute API compatible (OpenAI, Mistral, Ollama, LM Studio, vLLM…). */
  provider: AiProvider;
  base_url: string | null;
  model: string;
  /** Jamais renvoyée par l'API. */
  api_key: string | null;
  updated_by: string | null;
  updated_at: Generated<Date>;
}

export interface Database {
  workspaces: WorkspacesTable;
  users: UsersTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  projects: ProjectsTable;
  project_members: ProjectMembersTable;
  project_pins: ProjectPinsTable;
  rayons: RayonsTable;
  pages: PagesTable;
  page_restrictions: PageRestrictionsTable;
  page_versions: PageVersionsTable;
  comment_threads: CommentThreadsTable;
  comments: CommentsTable;
  comment_mentions: CommentMentionsTable;
  notifications: NotificationsTable;
  audit_events: AuditEventsTable;
  account_tokens: AccountTokensTable;
  attachments: AttachmentsTable;
  storage_trash: StorageTrashTable;
  page_links: PageLinksTable;
  api_specs: ApiSpecsTable;
  api_spec_versions: ApiSpecVersionsTable;
  api_tokens: ApiTokensTable;
  webhooks: WebhooksTable;
  webhook_deliveries: WebhookDeliveriesTable;
  git_syncs: GitSyncsTable;
  git_sync_assets: GitSyncAssetsTable;
  ai_settings: AiSettingsTable;
}

export type User = Selectable<UsersTable>;
export type Project = Selectable<ProjectsTable>;
export type Page = Selectable<PagesTable>;

export function ltreeLabel(id: string): string {
  return id.replaceAll('-', '_');
}
