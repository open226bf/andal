import { extractPageLinks, type JSONContent } from '@andal/editor';
import { Migrator, sql, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import type { Database } from './schema.js';

const initial: Migration = {
  async up(db: Kysely<any>) {
    await sql`create extension if not exists ltree`.execute(db);

    await db.schema
      .createTable('workspaces')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('users')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('workspace_id', 'uuid', (c) => c.notNull().references('workspaces.id').onDelete('cascade'))
      .addColumn('email', 'text', (c) => c.notNull())
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('initials', 'text', (c) => c.notNull())
      .addColumn('color', 'text', (c) => c.notNull())
      .addColumn('workspace_role', 'text', (c) => c.notNull().check(sql`workspace_role in ('owner', 'admin', 'member', 'guest')`))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint('users_workspace_email', ['workspace_id', 'email'])
      .execute();

    await db.schema
      .createTable('groups')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('workspace_id', 'uuid', (c) => c.notNull().references('workspaces.id').onDelete('cascade'))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('icon', 'text', (c) => c.notNull().defaultTo('users-three'))
      .execute();

    await db.schema
      .createTable('group_members')
      .addColumn('group_id', 'uuid', (c) => c.notNull().references('groups.id').onDelete('cascade'))
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addPrimaryKeyConstraint('group_members_pk', ['group_id', 'user_id'])
      .execute();

    await db.schema
      .createTable('projects')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('workspace_id', 'uuid', (c) => c.notNull().references('workspaces.id').onDelete('cascade'))
      .addColumn('slug', 'text', (c) => c.notNull())
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('short_name', 'text', (c) => c.notNull())
      .addColumn('description', 'text')
      .addColumn('cloth', 'text', (c) => c.notNull().check(sql`cloth in ('paiements', 'identite', 'donnees', 'mobile', 'plateforme', 'design')`))
      .addColumn('volume_number', 'integer', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint('projects_workspace_slug', ['workspace_id', 'slug'])
      .addUniqueConstraint('projects_workspace_volume', ['workspace_id', 'volume_number'])
      .execute();

    await db.schema
      .createTable('project_members')
      .addColumn('project_id', 'uuid', (c) => c.notNull().references('projects.id').onDelete('cascade'))
      .addColumn('principal_type', 'text', (c) => c.notNull().check(sql`principal_type in ('user', 'group')`))
      .addColumn('principal_id', 'uuid', (c) => c.notNull())
      .addColumn('role', 'text', (c) => c.notNull().check(sql`role in ('reader', 'commenter', 'editor', 'admin')`))
      .addPrimaryKeyConstraint('project_members_pk', ['project_id', 'principal_type', 'principal_id'])
      .execute();

    await db.schema
      .createTable('pages')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('project_id', 'uuid', (c) => c.notNull().references('projects.id').onDelete('cascade'))
      .addColumn('parent_id', 'uuid', (c) => c.references('pages.id').onDelete('cascade'))
      .addColumn('path', sql`ltree`, (c) => c.notNull())
      .addColumn('position', 'integer', (c) => c.notNull())
      .addColumn('title', 'text', (c) => c.notNull())
      .addColumn('summary', 'text')
      .addColumn('content', 'jsonb', (c) => c.notNull().defaultTo(sql`'{"type":"doc","content":[]}'::jsonb`))
      .addColumn('ydoc', 'bytea')
      .addColumn('text_content', 'text', (c) => c.notNull().defaultTo(''))
      .addColumn('search', sql`tsvector`, (c) =>
        c.generatedAlwaysAs(sql`setweight(to_tsvector('french', coalesce(title, '')), 'A') || setweight(to_tsvector('french', coalesce(summary, '') || ' ' || text_content), 'B')`).stored(),
      )
      .addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
      .addColumn('updated_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await sql`create index pages_path_gist on pages using gist (path)`.execute(db);
    await sql`create index pages_search_gin on pages using gin (search)`.execute(db);
    await db.schema.createIndex('pages_tree').on('pages').columns(['project_id', 'parent_id', 'position']).execute();

    await db.schema
      .createTable('page_restrictions')
      .addColumn('page_id', 'uuid', (c) => c.notNull().references('pages.id').onDelete('cascade'))
      .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('view', 'edit')`))
      .addColumn('principal_type', 'text', (c) => c.notNull().check(sql`principal_type in ('user', 'group')`))
      .addColumn('principal_id', 'uuid', (c) => c.notNull())
      .addPrimaryKeyConstraint('page_restrictions_pk', ['page_id', 'kind', 'principal_type', 'principal_id'])
      .execute();

    await db.schema
      .createTable('comment_threads')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('page_id', 'uuid', (c) => c.notNull().references('pages.id').onDelete('cascade'))
      .addColumn('resolved_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('comments')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('thread_id', 'uuid', (c) => c.notNull().references('comment_threads.id').onDelete('cascade'))
      .addColumn('author_id', 'uuid', (c) => c.notNull().references('users.id'))
      .addColumn('body', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('audit_events')
      .addColumn('id', 'bigint', (c) => c.primaryKey().generatedAlwaysAsIdentity())
      .addColumn('workspace_id', 'uuid', (c) => c.notNull().references('workspaces.id').onDelete('cascade'))
      .addColumn('actor_id', 'uuid')
      .addColumn('action', 'text', (c) => c.notNull())
      .addColumn('target_type', 'text', (c) => c.notNull())
      .addColumn('target_id', 'uuid')
      .addColumn('ip', 'text')
      .addColumn('metadata', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await sql`create index audit_events_recent on audit_events (workspace_id, created_at desc)`.execute(db);

    // Le journal d'audit est en ajout seul: toute modification ou suppression échoue.
    await sql`
      create function audit_events_append_only() returns trigger language plpgsql as $$
      begin
        raise exception 'audit_events est en ajout seul';
      end $$
    `.execute(db);
    await sql`
      create trigger audit_events_no_change before update or delete on audit_events
      for each row execute function audit_events_append_only()
    `.execute(db);
  },
};

const passwordAuth: Migration = {
  async up(db) {
    await db.schema
      .alterTable('users')
      .addColumn('username', 'text')
      .addColumn('password_hash', 'text')
      .addColumn('password_changed_at', 'timestamptz')
      .addColumn('oidc_issuer', 'text')
      .addColumn('oidc_subject', 'text')
      .execute();
    // La connexion compare sans tenir compte de la casse: l'unicité doit faire pareil.
    await sql`create unique index users_workspace_email_ci on users (workspace_id, lower(email))`.execute(db);
    await sql`create unique index users_workspace_username_ci on users (workspace_id, lower(username)) where username is not null`.execute(db);
    await sql`create unique index users_oidc_identity on users (oidc_issuer, oidc_subject) where oidc_subject is not null`.execute(db);
  },
  async down(db) {
    await sql`drop index users_oidc_identity, users_workspace_username_ci, users_workspace_email_ci`.execute(db);
    await db.schema
      .alterTable('users')
      .dropColumn('username')
      .dropColumn('password_hash')
      .dropColumn('password_changed_at')
      .dropColumn('oidc_issuer')
      .dropColumn('oidc_subject')
      .execute();
  },
};

const accountsAndThreads: Migration = {
  async up(db) {
    await db.schema.alterTable('users').addColumn('disabled_at', 'timestamptz').addColumn('last_login_at', 'timestamptz').execute();

    await db.schema
      .createTable('account_tokens')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('workspace_id', 'uuid', (c) => c.notNull().references('workspaces.id').onDelete('cascade'))
      .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('invite', 'reset')`))
      .addColumn('token_hash', 'text', (c) => c.notNull().unique())
      .addColumn('email', 'text', (c) => c.notNull())
      .addColumn('name', 'text')
      .addColumn('role', 'text', (c) => c.check(sql`role in ('owner', 'admin', 'member', 'guest')`))
      .addColumn('user_id', 'uuid', (c) => c.references('users.id').onDelete('cascade'))
      .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
      .addColumn('used_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await sql`create index account_tokens_pending on account_tokens (workspace_id, kind) where used_at is null`.execute(db);

    await db.schema
      .alterTable('comment_threads')
      .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('resolved_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .execute();
  },
  async down(db) {
    await db.schema.alterTable('comment_threads').dropColumn('created_by').dropColumn('resolved_by').execute();
    await db.schema.dropTable('account_tokens').execute();
    await db.schema.alterTable('users').dropColumn('disabled_at').dropColumn('last_login_at').execute();
  },
};

const accessAndNotifications: Migration = {
  async up(db) {
    await db.schema.alterTable('users').addColumn('notify_email', 'boolean', (c) => c.notNull().defaultTo(true)).execute();
    await db.schema.alterTable('account_tokens').addColumn('group_ids', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`)).execute();
    // Deux groupes du même nom seraient indiscernables dans le panneau Partager.
    await sql`create unique index groups_workspace_name_ci on groups (workspace_id, lower(name))`.execute(db);

    await db.schema
      .createTable('comment_mentions')
      .addColumn('comment_id', 'uuid', (c) => c.notNull().references('comments.id').onDelete('cascade'))
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addPrimaryKeyConstraint('comment_mentions_pk', ['comment_id', 'user_id'])
      .execute();

    await db.schema
      .createTable('notifications')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('mention', 'reply', 'resolved')`))
      .addColumn('actor_id', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('page_id', 'uuid', (c) => c.notNull().references('pages.id').onDelete('cascade'))
      // Un fil ou un commentaire supprimé emporte ses notifications.
      .addColumn('thread_id', 'uuid', (c) => c.notNull().references('comment_threads.id').onDelete('cascade'))
      .addColumn('comment_id', 'uuid', (c) => c.references('comments.id').onDelete('cascade'))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('read_at', 'timestamptz')
      .addColumn('emailed_at', 'timestamptz')
      .execute();
    await sql`create index notifications_inbox on notifications (user_id, created_at desc)`.execute(db);
    await sql`create index notifications_unread on notifications (user_id) where read_at is null`.execute(db);
  },
  async down(db) {
    await db.schema.dropTable('notifications').execute();
    await db.schema.dropTable('comment_mentions').execute();
    await sql`drop index groups_workspace_name_ci`.execute(db);
    await db.schema.alterTable('account_tokens').dropColumn('group_ids').execute();
    await db.schema.alterTable('users').dropColumn('notify_email').execute();
  },
};

const pagesTrash: Migration = {
  async up(db) {
    await db.schema
      .alterTable('pages')
      .addColumn('deleted_at', 'timestamptz')
      .addColumn('deleted_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .execute();
    await sql`create index pages_trash on pages (project_id, deleted_at) where deleted_at is not null`.execute(db);
  },
  async down(db) {
    await sql`drop index pages_trash`.execute(db);
    await db.schema.alterTable('pages').dropColumn('deleted_at').dropColumn('deleted_by').execute();
  },
};

const pageVersions: Migration = {
  async up(db) {
    await db.schema
      .createTable('page_versions')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('page_id', 'uuid', (c) => c.notNull().references('pages.id').onDelete('cascade'))
      .addColumn('version', 'integer', (c) => c.notNull())
      .addColumn('title', 'text', (c) => c.notNull())
      .addColumn('content', 'jsonb', (c) => c.notNull())
      .addColumn('authors', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint('page_versions_page_version', ['page_id', 'version'])
      .execute();
    // L'état actuel de chaque page devient sa première entrée d'historique.
    await sql`
      insert into page_versions (page_id, version, title, content, authors, created_at, updated_at)
      select id, version, title, content, case when updated_by is null then '[]'::jsonb else jsonb_build_array(updated_by) end, updated_at, updated_at
      from pages
    `.execute(db);
  },
  async down(db) {
    await db.schema.dropTable('page_versions').execute();
  },
};

const projectsArchive: Migration = {
  async up(db) {
    await db.schema
      .alterTable('projects')
      .addColumn('archived_at', 'timestamptz')
      .addColumn('archived_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .execute();
  },
  async down(db) {
    await db.schema.alterTable('projects').dropColumn('archived_at').dropColumn('archived_by').execute();
  },
};

const projectPins: Migration = {
  async up(db) {
    await db.schema
      .createTable('project_pins')
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('project_id', 'uuid', (c) => c.notNull().references('projects.id').onDelete('cascade'))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint('project_pins_pk', ['user_id', 'project_id'])
      .execute();
  },
  async down(db) {
    await db.schema.dropTable('project_pins').execute();
  },
};

const rayons: Migration = {
  async up(db) {
    await db.schema
      .createTable('rayons')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('workspace_id', 'uuid', (c) => c.notNull().references('workspaces.id').onDelete('cascade'))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('position', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await sql`create unique index rayons_workspace_name on rayons (workspace_id, lower(name))`.execute(db);
    // Supprimer un rayon laisse ses volumes « hors rayon », jamais sans toit.
    await db.schema.alterTable('projects').addColumn('rayon_id', 'uuid', (c) => c.references('rayons.id').onDelete('set null')).execute();
  },
  async down(db) {
    await db.schema.alterTable('projects').dropColumn('rayon_id').execute();
    await db.schema.dropTable('rayons').execute();
  },
};

const attachments: Migration = {
  async up(db) {
    await db.schema
      .createTable('attachments')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('page_id', 'uuid', (c) => c.notNull().references('pages.id').onDelete('cascade'))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('content_type', 'text', (c) => c.notNull())
      .addColumn('size', 'integer', (c) => c.notNull())
      .addColumn('storage_key', 'text', (c) => c.notNull().unique())
      .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema.createIndex('attachments_page').on('attachments').column('page_id').execute();
    // Quelle que soit la cause (page purgée, volume supprimé), l'objet stocké part à la corbeille du worker.
    await db.schema
      .createTable('storage_trash')
      .addColumn('storage_key', 'text', (c) => c.primaryKey())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await sql`
      create function attachments_to_storage_trash() returns trigger language plpgsql as $$
      begin
        insert into storage_trash (storage_key) values (old.storage_key) on conflict do nothing;
        return old;
      end $$`.execute(db);
    await sql`create trigger attachments_deleted after delete on attachments for each row execute function attachments_to_storage_trash()`.execute(db);
  },
  async down(db) {
    await sql`drop trigger attachments_deleted on attachments`.execute(db);
    await sql`drop function attachments_to_storage_trash()`.execute(db);
    await db.schema.dropTable('storage_trash').execute();
    await db.schema.dropTable('attachments').execute();
  },
};

const pageLinks: Migration = {
  async up(db) {
    await db.schema
      .createTable('page_links')
      .addColumn('source_id', 'uuid', (c) => c.notNull().references('pages.id').onDelete('cascade'))
      .addColumn('target_id', 'uuid', (c) => c.notNull().references('pages.id').onDelete('cascade'))
      .addPrimaryKeyConstraint('page_links_pk', ['source_id', 'target_id'])
      .execute();
    await db.schema.createIndex('page_links_target').on('page_links').column('target_id').execute();
    // Les pages déjà écrites: leurs liens sont relevés une fois ici, ensuite à chaque enregistrement.
    const pages = (await db.selectFrom('pages').select(['id', 'content']).execute()) as { id: string; content: JSONContent }[];
    const existing = new Set(pages.map((p) => p.id));
    const rows = pages.flatMap((p) => extractPageLinks(p.content).filter((t) => t !== p.id && existing.has(t)).map((target_id) => ({ source_id: p.id, target_id })));
    if (rows.length) await db.insertInto('page_links').values(rows).execute();
  },
  async down(db) {
    await db.schema.dropTable('page_links').execute();
  },
};

const apiSpecs: Migration = {
  async up(db) {
    await db.schema
      .createTable('api_specs')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('project_id', 'uuid', (c) => c.notNull().references('projects.id').onDelete('cascade'))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('title', 'text', (c) => c.notNull())
      .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint('api_specs_project_name', ['project_id', 'name'])
      .execute();
    await db.schema
      .createTable('api_spec_versions')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('spec_id', 'uuid', (c) => c.notNull().references('api_specs.id').onDelete('cascade'))
      .addColumn('sequence', 'integer', (c) => c.notNull())
      .addColumn('label', 'text', (c) => c.notNull())
      // json et non jsonb: l'ordre des chemins et des champs est celui de l'auteur de la spec.
      .addColumn('content', 'json', (c) => c.notNull())
      .addColumn('content_hash', 'text', (c) => c.notNull())
      .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint('api_spec_versions_sequence', ['spec_id', 'sequence'])
      .execute();
  },
  async down(db) {
    await db.schema.dropTable('api_spec_versions').execute();
    await db.schema.dropTable('api_specs').execute();
  },
};

const tokensAndWebhooks: Migration = {
  async up(db) {
    await db.schema
      .createTable('api_tokens')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('token_hash', 'text', (c) => c.notNull().unique())
      .addColumn('prefix', 'text', (c) => c.notNull())
      .addColumn('scope', 'text', (c) => c.notNull().check(sql`scope in ('read', 'write')`))
      .addColumn('expires_at', 'timestamptz')
      .addColumn('last_used_at', 'timestamptz')
      .addColumn('last_used_ip', 'text')
      .addColumn('revoked_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema.createIndex('api_tokens_user').on('api_tokens').column('user_id').execute();
    await db.schema
      .createTable('webhooks')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('workspace_id', 'uuid', (c) => c.notNull().references('workspaces.id').onDelete('cascade'))
      .addColumn('project_id', 'uuid', (c) => c.references('projects.id').onDelete('cascade'))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('url', 'text', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('generic', 'slack', 'teams')`))
      .addColumn('secret', 'text', (c) => c.notNull())
      .addColumn('events', sql`text[]`, (c) => c.notNull())
      .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
      .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema
      .createTable('webhook_deliveries')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('webhook_id', 'uuid', (c) => c.notNull().references('webhooks.id').onDelete('cascade'))
      .addColumn('event', 'text', (c) => c.notNull())
      .addColumn('attempt', 'integer', (c) => c.notNull())
      .addColumn('status', 'integer')
      .addColumn('error', 'text')
      .addColumn('duration_ms', 'integer')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema.createIndex('webhook_deliveries_webhook').on('webhook_deliveries').columns(['webhook_id', 'created_at']).execute();
  },
  async down(db) {
    await db.schema.dropTable('webhook_deliveries').execute();
    await db.schema.dropTable('webhooks').execute();
    await db.schema.dropTable('api_tokens').execute();
  },
};

const gitAndAi: Migration = {
  async up(db) {
    await db.schema
      .createTable('git_syncs')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('project_id', 'uuid', (c) => c.notNull().unique().references('projects.id').onDelete('cascade'))
      .addColumn('repo_url', 'text', (c) => c.notNull())
      .addColumn('branch', 'text', (c) => c.notNull().defaultTo('main'))
      .addColumn('path', 'text', (c) => c.notNull().defaultTo(''))
      .addColumn('access_token', 'text')
      .addColumn('webhook_secret', 'text', (c) => c.notNull())
      .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
      .addColumn('last_commit', 'text')
      .addColumn('last_synced_at', 'timestamptz')
      .addColumn('last_error', 'text')
      .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema.alterTable('pages').addColumn('git_sync_id', 'uuid', (c) => c.references('git_syncs.id').onDelete('set null')).addColumn('git_path', 'text').execute();
    await db.schema.createIndex('pages_git').on('pages').columns(['git_sync_id', 'git_path']).unique().where(sql.ref('git_sync_id'), 'is not', null).execute();
    await db.schema
      .createTable('git_sync_assets')
      .addColumn('sync_id', 'uuid', (c) => c.notNull().references('git_syncs.id').onDelete('cascade'))
      .addColumn('path', 'text', (c) => c.notNull())
      .addColumn('sha256', 'text', (c) => c.notNull())
      .addColumn('attachment_id', 'uuid', (c) => c.notNull().references('attachments.id').onDelete('cascade'))
      .addPrimaryKeyConstraint('git_sync_assets_pk', ['sync_id', 'path'])
      .execute();
    await db.schema
      .createTable('ai_settings')
      .addColumn('workspace_id', 'uuid', (c) => c.primaryKey().references('workspaces.id').onDelete('cascade'))
      .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
      .addColumn('provider', 'text', (c) => c.notNull().check(sql`provider in ('anthropic', 'openai')`))
      .addColumn('base_url', 'text')
      .addColumn('model', 'text', (c) => c.notNull())
      .addColumn('api_key', 'text')
      .addColumn('updated_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
  },
  async down(db) {
    await db.schema.dropTable('ai_settings').execute();
    await db.schema.dropTable('git_sync_assets').execute();
    await db.schema.alterTable('pages').dropColumn('git_path').dropColumn('git_sync_id').execute();
    await db.schema.dropTable('git_syncs').execute();
  },
};

const security: Migration = {
  async up(db) {
    await db.schema
      .alterTable('users')
      .addColumn('totp_secret', 'text')
      .addColumn('totp_enabled_at', 'timestamptz')
      .addColumn('totp_last_step', 'bigint')
      .addColumn('scim_external_id', 'text')
      .addColumn('deprovisioned_at', 'timestamptz')
      .execute();
    await sql`create unique index users_scim_external on users (workspace_id, scim_external_id) where scim_external_id is not null`.execute(db);
    await db.schema
      .createTable('recovery_codes')
      .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('code_hash', 'text', (c) => c.notNull())
      .addColumn('used_at', 'timestamptz')
      .addPrimaryKeyConstraint('recovery_codes_pk', ['user_id', 'code_hash'])
      .execute();
    await db.schema
      .alterTable('groups')
      .addColumn('source', 'text', (c) => c.notNull().defaultTo('local').check(sql`source in ('local', 'sso', 'scim')`))
      .addColumn('external_id', 'text')
      .execute();
    await sql`create unique index groups_external on groups (workspace_id, source, external_id) where external_id is not null`.execute(db);
    await db.schema
      .createTable('scim_tokens')
      .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('workspace_id', 'uuid', (c) => c.notNull().references('workspaces.id').onDelete('cascade'))
      .addColumn('token_hash', 'text', (c) => c.notNull().unique())
      .addColumn('prefix', 'text', (c) => c.notNull())
      .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('last_used_at', 'timestamptz')
      .addColumn('revoked_at', 'timestamptz')
      .execute();
    // Filtres du journal d'audit: par personne et par action.
    await sql`create index audit_events_actor on audit_events (workspace_id, actor_id, created_at desc)`.execute(db);
    await sql`create index audit_events_action on audit_events (workspace_id, action, created_at desc)`.execute(db);
  },
  async down(db) {
    await sql`drop index audit_events_action`.execute(db);
    await sql`drop index audit_events_actor`.execute(db);
    await db.schema.dropTable('scim_tokens').execute();
    await sql`drop index groups_external`.execute(db);
    await db.schema.alterTable('groups').dropColumn('external_id').dropColumn('source').execute();
    await db.schema.dropTable('recovery_codes').execute();
    await sql`drop index users_scim_external`.execute(db);
    await db.schema.alterTable('users').dropColumn('deprovisioned_at').dropColumn('scim_external_id').dropColumn('totp_last_step').dropColumn('totp_enabled_at').dropColumn('totp_secret').execute();
  },
};

const userLocale: Migration = {
  async up(db) {
    await db.schema
      .alterTable('users')
      .addColumn('locale', 'text', (c) => c.notNull().defaultTo('fr').check(sql`locale in ('fr', 'en')`))
      .execute();
  },
  async down(db) {
    await db.schema.alterTable('users').dropColumn('locale').execute();
  },
};

const provider: MigrationProvider = {
  async getMigrations() {
    return {
      '0001_initial': initial,
      '0002_password_auth': passwordAuth,
      '0003_accounts_threads': accountsAndThreads,
      '0004_access_notifications': accessAndNotifications,
      '0005_pages_trash': pagesTrash,
      '0006_page_versions': pageVersions,
      '0007_projects_archive': projectsArchive,
      '0008_project_pins': projectPins,
      '0009_rayons': rayons,
      '0010_attachments': attachments,
      '0011_page_links': pageLinks,
      '0012_api_specs': apiSpecs,
      '0013_tokens_webhooks': tokensAndWebhooks,
      '0014_git_ai': gitAndAi,
      '0015_security': security,
      '0016_user_locale': userLocale,
    };
  },
};

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    console.log(`${r.status === 'Success' ? 'appliquée' : r.status}: ${r.migrationName}`);
  }
  if (error) throw error;
}
