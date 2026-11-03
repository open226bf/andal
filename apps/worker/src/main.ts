/**
 * Tâches de fond (BullMQ sur Valkey).
 *
 * - page.index: recalcule le texte indexé d'une page après une modification.
 * - notifications.email: envoie, après un délai, les notifications restées non lues.
 * - trash.purge: vide la corbeille des pages, puis efface les fichiers devenus orphelins.
 * - webhook.event: trouve les intégrations abonnées à un événement, et leur prépare un envoi.
 * - webhook.deliver: envoie, signe, et réessaie avec un délai croissant (6 tentatives).
 * - git.sync: synchronise un dossier de dépôt Git vers un volume (toutes les 10 minutes, ou sur push).
 *
 * Prochaines tâches prévues: export PDF (Gotenberg), miniatures.
 * Une tâche lancée pour un utilisateur garde son identité et revérifie ses droits.
 */
import { can } from '@andal/authz';
import {
  createDb,
  deliverWebhook,
  emptyStorageTrash,
  loadSubject,
  pageRoleFor,
  renderMail,
  requireEnv,
  Storage,
  storageConfigFromEnv,
  webhookRequest,
  type NotificationKind,
  type WebhookEventJob,
  type WebhookPayload,
} from '@andal/db';
import { extractPageLinks, extractText, type JSONContent } from '@andal/editor';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { syncRepository } from './git-sync.js';
import { sql } from 'kysely';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // Pas de .env: environnement du processus.
}

const valkeyUrl = process.env.VALKEY_URL ?? 'redis://127.0.0.1:56379';
const webOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '');
const db = createDb(requireEnv('DATABASE_URL'), 4);
const connection = new Redis(valkeyUrl, { maxRetriesPerRequest: null });
const smtpUrl = process.env.SMTP_URL?.trim();
const mailer = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
const mailFrom = process.env.MAIL_FROM?.trim() || 'Andal <andal@localhost>';
const queue = new Queue('andal', { connection: new Redis(valkeyUrl, { maxRetriesPerRequest: null }) });
const cache = new Redis(valkeyUrl);
const storageConfig = storageConfigFromEnv();
const storage = storageConfig ? new Storage(storageConfig) : null;
/** Autoriser les webhooks vers le réseau interne (Mattermost sur le LAN, tests). Désactivé par défaut. */
const webhookAllowPrivate = process.env.WEBHOOK_ALLOW_PRIVATE === 'true';
/** Une rafale de modifications ne donne qu'un seul « page.updated », envoyé après ce délai. */
const PAGE_UPDATED_DELAY_MS = Math.max(0, Number(process.env.WEBHOOK_UPDATE_DELAY ?? 120)) * 1000;
/** Dépôts Git sur le réseau interne ou en file:// (forge interne, tests). Désactivé par défaut. */
const gitAllowLocal = process.env.GIT_ALLOW_LOCAL === 'true';

interface GitSyncJob {
  syncId: string;
  force?: boolean;
}

async function gitSync({ syncId, force }: GitSyncJob) {
  const result = await syncRepository({ db, valkey: cache, queue, storage, allowLocal: gitAllowLocal }, syncId, { force });
  if (result && !result.skipped) console.log(`Synchro Git ${syncId}: ${result.commit.slice(0, 7)}, ${result.created} créée(s), ${result.updated} mise(s) à jour, ${result.removed} retirée(s).`);
}

/** Toutes les synchros actives: une tâche chacune (une seule à la fois par volume, grâce au jobId). */
async function gitSyncAll() {
  const syncs = await db.selectFrom('git_syncs').select('id').where('enabled', '=', true).execute();
  await queue.addBulk(syncs.map((s) => ({ name: 'git.sync', data: { syncId: s.id } satisfies GitSyncJob, opts: { jobId: `git-sync-${s.id}`, removeOnComplete: true, removeOnFail: 50 } })));
}

interface IndexJob {
  pageId: string;
}

interface EmailJob {
  userId: string;
}

/** Texte de recherche et liens vers d'autres pages (rétroliens), recalculés après chaque modification. */
async function indexPage({ pageId }: IndexJob) {
  const page = await db.selectFrom('pages as p').innerJoin('projects as v', 'v.id', 'p.project_id').select(['p.id', 'p.content', 'p.project_id', 'v.workspace_id']).where('p.id', '=', pageId).executeTakeFirst();
  if (!page) return;
  const content = page.content as JSONContent;
  const cited = extractPageLinks(content).filter((id) => id !== page.id);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('pages').set({ text_content: extractText(content) }).where('id', '=', page.id).execute();
    await trx.deleteFrom('page_links').where('source_id', '=', page.id).execute();
    const targets = cited.length ? await trx.selectFrom('pages').select('id').where('id', 'in', cited).execute() : [];
    if (targets.length) await trx.insertInto('page_links').values(targets.map((t) => ({ source_id: page.id, target_id: t.id }))).execute();
  });
  // Un seul événement par rafale: tant qu'il attend, les suivants (même jobId) sont ignorés.
  await queue.add(
    'webhook.event',
    { event: 'page.updated', workspaceId: page.workspace_id, projectId: page.project_id, actorId: null, pageId: page.id } satisfies WebhookEventJob,
    { jobId: `page-updated-${page.id}`, delay: PAGE_UPDATED_DELAY_MS, removeOnComplete: true, removeOnFail: 100 },
  );
}

/** Une page sous restriction de lecture (elle ou un parent) ne part jamais vers une intégration. */
async function restricted(pageId: string): Promise<boolean> {
  const row = await sql<{ one: number }>`
    select 1 as one from page_restrictions r
    join pages a on a.id = r.page_id
    join pages p on p.id = ${pageId}
    where r.kind = 'view' and a.path @> p.path
    limit 1`.execute(db);
  return row.rows.length > 0;
}

/** Le message, relu en base au moment de l'envoi: titre, auteur et lien à jour. */
async function buildPayload(job: WebhookEventJob): Promise<WebhookPayload | null> {
  const project = await db.selectFrom('projects').select(['id', 'slug', 'name']).where('id', '=', job.projectId).executeTakeFirst();
  if (!project) return null;
  const payload: WebhookPayload = { id: randomUUID(), event: job.event, createdAt: new Date().toISOString(), actor: null, project };
  let actorId = job.actorId;
  if (job.pageId) {
    const page = await db.selectFrom('pages').select(['id', 'title', 'updated_by', 'created_at', 'deleted_at']).where('id', '=', job.pageId).executeTakeFirst();
    if (!page) return null;
    if (job.event === 'page.updated') {
      // Page à la corbeille, ou tout juste annoncée par « page.created »: rien de plus à dire.
      if (page.deleted_at || (await cache.exists(`andal:wh:created:${page.id}`))) return null;
      actorId = page.updated_by;
    }
    payload.page = { id: page.id, title: page.title, url: `${webOrigin}/p/${page.id}` };
  }
  if (job.commentId && payload.page) {
    const comment = await db.selectFrom('comments').select(['id', 'body', 'thread_id']).where('id', '=', job.commentId).executeTakeFirst();
    if (!comment) return null;
    const excerpt = comment.body.replace(/\s+/g, ' ').trim();
    payload.comment = { id: comment.id, excerpt: excerpt.length > 280 ? `${excerpt.slice(0, 279)}…` : excerpt, url: `${webOrigin}/v/${project.slug}/${payload.page.id}?fil=${comment.thread_id}` };
  }
  if (job.specId) {
    const spec = await db
      .selectFrom('api_specs as s')
      .innerJoin('api_spec_versions as v', 'v.spec_id', 's.id')
      .select(['s.id', 's.name', 's.title', 'v.label', 'v.sequence'])
      .where('s.id', '=', job.specId)
      .orderBy('v.sequence', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!spec) return null;
    payload.spec = { id: spec.id, name: spec.name, title: spec.title, version: spec.label || String(spec.sequence), url: `${webOrigin}/specs/${spec.id}` };
  }
  if (actorId) {
    const actor = await db.selectFrom('users').select(['id', 'name']).where('id', '=', actorId).executeTakeFirst();
    payload.actor = actor ?? null;
  }
  return payload;
}

interface DeliverJob {
  webhookId: string;
  payload: WebhookPayload;
}

/** Les intégrations abonnées à l'événement, sur ce volume ou sur tout l'espace. */
async function fanOut(job: WebhookEventJob) {
  const hooks = await db
    .selectFrom('webhooks')
    .select('id')
    .where('workspace_id', '=', job.workspaceId)
    .where('active', '=', true)
    .where((eb) => eb.or([eb('project_id', 'is', null), eb('project_id', '=', job.projectId)]))
    .where(sql<boolean>`${job.event} = any(events)`)
    .execute();
  if (hooks.length === 0) return;
  if (job.pageId && (await restricted(job.pageId))) return;
  const payload = await buildPayload(job);
  if (!payload) return;
  if (job.event === 'page.created' && job.pageId) await cache.set(`andal:wh:created:${job.pageId}`, '1', 'EX', Math.ceil(PAGE_UPDATED_DELAY_MS / 1000) + 60);
  await queue.addBulk(
    hooks.map((h) => ({
      name: 'webhook.deliver',
      data: { webhookId: h.id, payload } satisfies DeliverJob,
      // 30 s, 1 min, 2 min, 4 min, 8 min: une panne passagère du destinataire ne perd rien.
      opts: { attempts: 6, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 100, removeOnFail: 200 },
    })),
  );
}

const DELIVERIES_KEPT = 50;

async function deliver({ webhookId, payload }: DeliverJob, attempt: number) {
  const hook = await db.selectFrom('webhooks').selectAll().where('id', '=', webhookId).executeTakeFirst();
  if (!hook || !hook.active) return;
  const { body, headers } = webhookRequest(hook.kind, hook.secret, payload);
  const result = await deliverWebhook(hook.url, body, headers, { allowPrivate: webhookAllowPrivate });
  await db.insertInto('webhook_deliveries').values({ webhook_id: hook.id, event: payload.event, attempt, status: result.status, error: result.error, duration_ms: result.durationMs }).execute();
  await sql`delete from webhook_deliveries where webhook_id = ${hook.id} and id not in (select id from webhook_deliveries where webhook_id = ${hook.id} order by created_at desc limit ${DELIVERIES_KEPT})`.execute(db);
  if (!result.error) return;
  if (!result.retry) throw new UnrecoverableError(result.error);
  throw new Error(result.error);
}

/** Corbeille: au-delà de ce délai, une page supprimée l'est définitivement. */
const TRASH_RETENTION_DAYS = Math.max(1, Number(process.env.TRASH_RETENTION_DAYS ?? 30));

/**
 * Vide la corbeille de ce qui y dort depuis trop longtemps. Les sous-pages,
 * commentaires, versions et notifications suivent par les clés étrangères.
 * Chaque page supprimée laisse une trace dans le journal d'audit.
 */
async function purgeTrash() {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const purged = await db.deleteFrom('pages').where('deleted_at', '<', cutoff).returning(['id', 'title', 'project_id']).execute();
  if (purged.length === 0) return;
  const projects = await db.selectFrom('projects').select(['id', 'workspace_id']).where('id', 'in', [...new Set(purged.map((p) => p.project_id))]).execute();
  await db
    .insertInto('audit_events')
    .values(
      purged.map((p) => ({
        workspace_id: projects.find((pr) => pr.id === p.project_id)!.workspace_id,
        actor_id: null,
        action: 'page.purged_automatically',
        target_type: 'page',
        target_id: p.id,
        metadata: JSON.stringify({ title: p.title, retentionDays: TRASH_RETENTION_DAYS }),
      })),
    )
    .execute();
  console.log(`Corbeille: ${purged.length} page(s) supprimée(s) définitivement.`);
}

/** Les fichiers des pages purgées et des volumes supprimés quittent aussi le stockage. */
async function sweepStorage() {
  if (!storage) return;
  const removed = await emptyStorageTrash(db, storage);
  if (removed) console.log(`Stockage: ${removed} fichier(s) orphelin(s) effacé(s).`);
}

const DIGEST_SIZE = 20;

function sentence(kind: NotificationKind, actor: string, page: string): string {
  if (kind === 'mention') return `${actor} vous a cité sur « ${page} ».`;
  if (kind === 'resolved') return `${actor} a résolu votre fil sur « ${page} ».`;
  return `${actor} a répondu dans un fil que vous suivez, sur « ${page} ».`;
}

function excerpt(body: string | null): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 240 ? `${flat.slice(0, 239)}…` : flat;
}

/**
 * Rattrapage par email: ce qui est encore non lu, et pas déjà envoyé, part en
 * un seul message. Les droits sont revérifiés: une page devenue illisible
 * n'apparaît pas.
 */
async function emailNotifications({ userId }: EmailJob) {
  if (!mailer) return;
  const loaded = await loadSubject(db, userId);
  if (!loaded || loaded.user.disabled_at || !loaded.user.notify_email) return;
  const rows = await db
    .selectFrom('notifications as n')
    .innerJoin('pages as p', 'p.id', 'n.page_id')
    .innerJoin('projects as pr', 'pr.id', 'p.project_id')
    .leftJoin('users as a', 'a.id', 'n.actor_id')
    .leftJoin('comments as c', 'c.id', 'n.comment_id')
    .select(['n.id', 'n.kind', 'n.page_id', 'n.thread_id', 'p.title', 'pr.slug', 'pr.short_name', 'a.name as actor', 'c.body'])
    .where('n.user_id', '=', userId)
    .where('n.read_at', 'is', null)
    .where('n.emailed_at', 'is', null)
    .orderBy('n.created_at')
    .limit(DIGEST_SIZE)
    .execute();

  const readable = new Map<string, boolean>();
  for (const pageId of new Set(rows.map((r) => r.page_id))) {
    readable.set(pageId, can((await pageRoleFor(db, loaded.subject, pageId))?.role ?? null, 'page.read'));
  }
  const items = rows.filter((r) => readable.get(r.page_id));
  if (items.length === 0) return;

  const link = (r: (typeof items)[number]) => `${webOrigin}/v/${r.slug}/${r.page_id}?fil=${r.thread_id}`;
  const about = (r: (typeof items)[number]) => sentence(r.kind, r.actor ?? 'Quelqu’un', `${r.title} (${r.short_name})`);
  const first = items[0]!;
  const single = items.length === 1;
  const subject = single ? about(first).replace(/\.$/, '') : `${items.length} nouveautés vous attendent sur Andal`;
  const { text, html } = renderMail({
    to: loaded.user.email,
    subject,
    lines: [
      `Bonjour ${loaded.user.name},`,
      ...(single ? [about(first)] : ['Voici ce qui vous attend sur Andal :', ...items.map((r) => `• ${about(r)}${r.body ? ` « ${excerpt(r.body)} »` : ''}`)]),
    ],
    quotes: single && first.body ? [excerpt(first.body)!] : [],
    action: { label: single ? 'Ouvrir le fil' : 'Ouvrir le premier fil', url: link(first) },
    footer: 'Vous recevez cet email parce que ces notifications n’ont pas été lues dans Andal. Pour ne plus les recevoir par email, décochez « Aussi par email » dans vos notifications.',
  });
  await mailer.sendMail({ from: mailFrom, to: loaded.user.email, subject, text, html });
  await db.updateTable('notifications').set({ emailed_at: new Date() }).where('id', 'in', items.map((r) => r.id)).execute();
}

const worker = new Worker<IndexJob | EmailJob | WebhookEventJob | DeliverJob | GitSyncJob>(
  'andal',
  async (job) => {
    if (job.name === 'page.index') await indexPage(job.data as IndexJob);
    else if (job.name === 'webhook.event') await fanOut(job.data as WebhookEventJob);
    else if (job.name === 'webhook.deliver') await deliver(job.data as DeliverJob, job.attemptsMade + 1);
    else if (job.name === 'git.sync') await gitSync(job.data as GitSyncJob);
    else if (job.name === 'git.sync.all') await gitSyncAll();
    else if (job.name === 'notifications.email') await emailNotifications(job.data as EmailJob);
    else if (job.name === 'trash.purge') {
      await purgeTrash();
      await sweepStorage();
    } else if (job.name === 'storage.sweep') await sweepStorage();
  },
  { connection, concurrency: 4 },
);

worker.on('failed', (job, error) => console.error(`Tâche ${job?.name} échouée:`, error.message));

// Au démarrage, indexe les pages jamais indexées (données de démo, import…).
const pending = await db.selectFrom('pages').select('id').where('text_content', '=', '').execute();
await queue.addBulk(pending.map((p) => ({ name: 'page.index', data: { pageId: p.id }, opts: { removeOnComplete: 100 } })));
// Purge de la corbeille toutes les 6 heures (une seule planification, quel que soit le nombre de workers).
await queue.upsertJobScheduler('trash-purge', { every: 6 * 60 * 60 * 1000 }, { name: 'trash.purge', opts: { removeOnComplete: 10, removeOnFail: 50 } });
// Les fichiers d'une page purgée à la main (API) sont effacés dans l'heure.
await queue.upsertJobScheduler('storage-sweep', { every: 60 * 60 * 1000 }, { name: 'storage.sweep', opts: { removeOnComplete: 10, removeOnFail: 50 } });
// Synchros Git: toutes les 10 minutes, en plus des webhooks « push » des forges.
await queue.upsertJobScheduler('git-sync-all', { every: 10 * 60 * 1000 }, { name: 'git.sync.all', opts: { removeOnComplete: 10, removeOnFail: 50 } });
console.log(`Worker Andal prêt (${pending.length} page(s) à indexer, emails ${mailer ? 'actifs' : 'désactivés'}).`);

async function shutdown() {
  await worker.close();
  await queue.close();
  cache.disconnect();
  storage?.destroy();
  await db.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
