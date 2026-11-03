/**
 * Tâches de fond (BullMQ sur Valkey).
 *
 * - page.index: recalcule le texte indexé d'une page après une modification.
 * - notifications.email: envoie, après un délai, les notifications restées non lues.
 * - trash.purge: vide la corbeille des pages, puis efface les fichiers devenus orphelins.
 *
 * Prochaines tâches prévues: export PDF (Gotenberg), miniatures.
 * Une tâche lancée pour un utilisateur garde son identité et revérifie ses droits.
 */
import { can } from '@andal/authz';
import { createDb, emptyStorageTrash, loadSubject, pageRoleFor, renderMail, requireEnv, Storage, storageConfigFromEnv, type NotificationKind } from '@andal/db';
import { extractPageLinks, extractText, type JSONContent } from '@andal/editor';
import { Queue, Worker } from 'bullmq';
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
const storageConfig = storageConfigFromEnv();
const storage = storageConfig ? new Storage(storageConfig) : null;

interface IndexJob {
  pageId: string;
}

interface EmailJob {
  userId: string;
}

/** Texte de recherche et liens vers d'autres pages (rétroliens), recalculés après chaque modification. */
async function indexPage({ pageId }: IndexJob) {
  const page = await db.selectFrom('pages').select(['id', 'content']).where('id', '=', pageId).executeTakeFirst();
  if (!page) return;
  const content = page.content as JSONContent;
  const cited = extractPageLinks(content).filter((id) => id !== page.id);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('pages').set({ text_content: extractText(content) }).where('id', '=', page.id).execute();
    await trx.deleteFrom('page_links').where('source_id', '=', page.id).execute();
    const targets = cited.length ? await trx.selectFrom('pages').select('id').where('id', 'in', cited).execute() : [];
    if (targets.length) await trx.insertInto('page_links').values(targets.map((t) => ({ source_id: page.id, target_id: t.id }))).execute();
  });
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

const worker = new Worker<IndexJob | EmailJob>(
  'andal',
  async (job) => {
    if (job.name === 'page.index') await indexPage(job.data as IndexJob);
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
console.log(`Worker Andal prêt (${pending.length} page(s) à indexer, emails ${mailer ? 'actifs' : 'désactivés'}).`);

async function shutdown() {
  await worker.close();
  await queue.close();
  storage?.destroy();
  await db.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
