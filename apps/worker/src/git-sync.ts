/**
 * Synchro Git → Andal, à sens unique (docs-as-code).
 *
 * Chaque fichier Markdown du dossier choisi devient une page; un sous-dossier
 * devient une page parente (son README.md ou index.md en est le contenu). Les
 * pages ainsi tenues se lisent et se commentent dans Andal, mais s'écrivent
 * dans le dépôt: la synchro suivante les remet à jour, et retire celles dont
 * le fichier a disparu. Les liens relatifs entre fichiers deviennent des liens
 * entre pages; les images du dépôt sont envoyées comme pièces jointes.
 */
import { collabBroadcast, collabWrite, isPrivateAddress, linkSpecBlocks, ltreeLabel, sniffImage, type Database, type Storage } from '@andal/db';
import { sameDoc, validateDoc, type JSONContent } from '@andal/editor';
import { fromMarkdown } from '@andal/editor/markdown';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const MAX_FILES = 1000;
const MAX_MARKDOWN_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const INDEX_FILES = new Set(['readme.md', 'index.md', '_index.md']);
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };

export interface GitSyncContext {
  db: Kysely<Database>;
  valkey: Redis;
  queue: Queue;
  storage: Storage | null;
  /** Dépôts sur le réseau interne ou en file:// (tests, forge interne). Désactivé par défaut. */
  allowLocal: boolean;
}

export interface GitSyncResult {
  commit: string;
  skipped: boolean;
  created: number;
  updated: number;
  removed: number;
  errors: string[];
}

interface Entry {
  /** Chemin dans le dossier synchronisé: « api/auth.md », ou « api » pour un dossier. */
  key: string;
  parentKey: string | null;
  /** Fichier Markdown du contenu (absolu); null: dossier sans README. */
  file: string | null;
  title: string;
  position: number;
}

/** « 02-premiers-pas.md » → « Premiers pas ». */
function prettify(name: string): string {
  const bare = name.replace(/\.(md|markdown)$/i, '').replace(/^\d+[-_. ]+/, '').replace(/[-_]+/g, ' ').trim();
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : name;
}

/** En-tête YAML minimal (« title: … », « position: 3 »), puis le reste du fichier. */
function frontMatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text.replace(/^﻿/, '') };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(match[0].length) };
}

function leadingTitle(body: string): string | null {
  return /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body.split(/\r?\n/).find((l) => l.trim()) ?? '')?.[1] ?? null;
}

async function checkRemote(url: string, allowLocal: boolean): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Adresse du dépôt invalide.');
  }
  if (parsed.protocol === 'file:' && allowLocal) return;
  if (parsed.protocol !== 'https:') throw new Error('Seuls les dépôts en https:// sont acceptés.');
  if (parsed.username || parsed.password) throw new Error('Pas d’identifiants dans l’adresse: utilisez le jeton d’accès.');
  if (allowLocal) return;
  const addresses = await lookup(parsed.hostname, { all: true });
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error('Dépôt sur le réseau interne refusé (GIT_ALLOW_LOCAL).');
}

/** Clone superficiel, sans invite, sans hooks, https seulement (le jeton passe par l'environnement, jamais par l'URL). */
async function clone(url: string, branch: string, token: string | null, target: string, allowLocal: boolean): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: target,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_ALLOW_PROTOCOL: allowLocal ? 'https:file' : 'https',
  };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  }
  try {
    await run('git', ['clone', '--quiet', '--depth', '1', '--single-branch', '--no-tags', '--branch', branch, '--', url, join(target, 'repo')], { env, timeout: 120_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '').trim().split('\n').pop() ?? '';
    throw new Error(`Clonage impossible: ${stderr.replace(/Basic \S+/g, 'Basic ***') || (error as Error).message}`);
  }
  const { stdout } = await run('git', ['-C', join(target, 'repo'), 'rev-parse', 'HEAD'], { env, timeout: 10_000 });
  return stdout.trim();
}

/** Les fichiers Markdown du dossier, sans suivre les liens symboliques ni les dossiers cachés. */
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        out.push(full);
        if (out.length > MAX_FILES) throw new Error(`Plus de ${MAX_FILES} fichiers Markdown: choisissez un dossier plus précis.`);
      }
    }
  };
  await visit(root);
  return out;
}

/** Fichiers → entrées (pages), dossiers compris, avec titres et positions. */
async function entries(root: string, files: string[]): Promise<Entry[]> {
  const byKey = new Map<string, Entry & { order: string }>();
  const ensureDir = (dirKey: string) => {
    if (!dirKey || byKey.has(dirKey)) return;
    const parent = posix.dirname(dirKey);
    ensureDir(parent === '.' ? '' : parent);
    byKey.set(dirKey, { key: dirKey, parentKey: parent === '.' ? null : parent, file: null, title: prettify(posix.basename(dirKey)), position: Number.NaN, order: posix.basename(dirKey) });
  };
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    const dirKey = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);
    const isIndex = INDEX_FILES.has(posix.basename(rel).toLowerCase()) && dirKey !== '';
    const key = isIndex ? dirKey : rel;
    ensureDir(dirKey);
    const parentKey = isIndex ? (posix.dirname(dirKey) === '.' ? null : posix.dirname(dirKey)) : dirKey || null;
    const text = (await readFile(file, 'utf8')).slice(0, MAX_MARKDOWN_BYTES);
    const { meta, body } = frontMatter(text);
    const name = isIndex ? posix.basename(dirKey) : posix.basename(rel);
    const existing = byKey.get(key);
    byKey.set(key, {
      key,
      parentKey,
      file,
      title: (meta.title || leadingTitle(body) || prettify(name)).slice(0, 200),
      position: meta.position !== undefined || meta.order !== undefined ? Number(meta.position ?? meta.order) : Number.NaN,
      order: existing?.order ?? name,
    });
  }
  // Ordre: position explicite, puis nom de fichier (« 01-… » d'abord), à chaque niveau.
  const list = [...byKey.values()];
  const siblings = new Map<string | null, typeof list>();
  for (const e of list) siblings.set(e.parentKey, [...(siblings.get(e.parentKey) ?? []), e]);
  for (const group of siblings.values()) {
    group.sort((a, b) => (Number.isNaN(a.position) ? 1e9 : a.position) - (Number.isNaN(b.position) ? 1e9 : b.position) || a.order.localeCompare(b.order, 'fr', { numeric: true }));
    group.forEach((e, i) => (e.position = i + 1));
  }
  return list.sort((a, b) => a.key.split('/').length - b.key.split('/').length || a.position - b.position);
}

/** Envoie la commande « replace » au serveur collab et attend sa réponse. */
async function replaceLive(valkey: Redis, pageId: string, content: JSONContent, userId: string | null): Promise<string> {
  const requestId = randomUUID();
  return collabWrite(valkey, { op: 'replace', requestId, pageId, content, userId }, 15);
}

export async function syncRepository(ctx: GitSyncContext, syncId: string, options: { force?: boolean } = {}): Promise<GitSyncResult | null> {
  const { db } = ctx;
  const sync = await db
    .selectFrom('git_syncs as g')
    .innerJoin('projects as p', 'p.id', 'g.project_id')
    .selectAll('g')
    .select(['p.archived_at'])
    .where('g.id', '=', syncId)
    .executeTakeFirst();
  if (!sync || !sync.enabled || sync.archived_at) return null;

  const work = await mkdtemp(join(tmpdir(), 'andal-git-'));
  try {
    await checkRemote(sync.repo_url, ctx.allowLocal);
    const commit = await clone(sync.repo_url, sync.branch, sync.access_token, work, ctx.allowLocal);
    if (commit === sync.last_commit && !options.force) {
      await db.updateTable('git_syncs').set({ last_synced_at: new Date(), last_error: null }).where('id', '=', sync.id).execute();
      return { commit, skipped: true, created: 0, updated: 0, removed: 0, errors: [] };
    }

    const repo = join(work, 'repo');
    const root = resolve(repo, sync.path.replace(/^\/+/, ''));
    if (root !== repo && !root.startsWith(repo + sep)) throw new Error('Dossier hors du dépôt.');
    const exists = await lstat(root).catch(() => null);
    if (!exists?.isDirectory()) throw new Error(`Le dossier « ${sync.path || '/'} » n’existe pas sur la branche ${sync.branch}.`);

    const list = await entries(root, await walk(root));
    const author = sync.created_by;
    const existing = await db.selectFrom('pages').select(['id', 'git_path', 'parent_id', 'path', 'title', 'position', 'content', 'deleted_at']).where('git_sync_id', '=', sync.id).execute();
    const byKey = new Map(existing.map((p) => [p.git_path!, p]));
    const pageOf = new Map<string, { id: string; path: string }>();
    const fresh = new Set<string>();
    const result: GitSyncResult = { commit, skipped: false, created: 0, updated: 0, removed: 0, errors: [] };

    // 1. L'arbre: pages créées, renommées, déplacées, remises en ordre.
    for (const entry of list) {
      const parent = entry.parentKey ? pageOf.get(entry.parentKey) : null;
      const current = byKey.get(entry.key);
      if (current && !current.deleted_at) {
        const parentId = parent?.id ?? null;
        let path = current.path;
        if (current.parent_id !== parentId) {
          path = parent ? `${parent.path}.${ltreeLabel(current.id)}` : ltreeLabel(current.id);
          await sql`update pages set path = ${path}::ltree || subpath(path, nlevel(${current.path}::ltree)) where path <@ ${current.path}::ltree`.execute(db);
          await db.updateTable('pages').set({ parent_id: parentId }).where('id', '=', current.id).execute();
        }
        if (current.title !== entry.title || current.position !== entry.position) {
          await db.updateTable('pages').set({ title: entry.title, position: entry.position }).where('id', '=', current.id).execute();
        }
        pageOf.set(entry.key, { id: current.id, path });
      } else {
        const id = randomUUID();
        const path = parent ? `${parent.path}.${ltreeLabel(id)}` : ltreeLabel(id);
        if (current) await db.updateTable('pages').set({ git_sync_id: null, git_path: null }).where('id', '=', current.id).execute();
        // Après les pages écrites à la main, au premier niveau comme dans un dossier.
        const base = parent ? 0 : Number((await db.selectFrom('pages').select((eb) => eb.fn.max('position').as('m')).where('project_id', '=', sync.project_id).where('parent_id', 'is', null).where('git_sync_id', 'is', null).executeTakeFirst())?.m ?? 0);
        await db
          .insertInto('pages')
          .values({ id, project_id: sync.project_id, parent_id: parent?.id ?? null, path, position: base + entry.position, title: entry.title, content: JSON.stringify(EMPTY_DOC), updated_by: author, git_sync_id: sync.id, git_path: entry.key })
          .execute();
        await db.insertInto('page_versions').values({ page_id: id, version: 1, title: entry.title, content: JSON.stringify(EMPTY_DOC), authors: JSON.stringify(author ? [author] : []) }).execute();
        pageOf.set(entry.key, { id, path });
        fresh.add(entry.key);
        result.created++;
      }
    }

    // 2. Le contenu: liens relatifs → pages, images → pièces jointes, blocs OpenAPI → specs du volume.
    for (const entry of list) {
      const page = pageOf.get(entry.key)!;
      let doc: JSONContent = EMPTY_DOC;
      if (entry.file) {
        const { body } = frontMatter((await readFile(entry.file, 'utf8')).slice(0, MAX_MARKDOWN_BYTES));
        const text = body.replace(/^\s*#\s+[^\n]*\n+/, (line) => (line.replace(/^\s*#\s+/, '').trim() === entry.title ? '' : line));
        const markdown = await rewrite(ctx, sync.id, root, entry.file, text, page.id, pageOf);
        doc = await linkSpecBlocks(db, sync.project_id, fromMarkdown(markdown));
        const problem = validateDoc(doc);
        if (problem) {
          result.errors.push(`${entry.key}: ${problem}`);
          continue;
        }
      }
      if (fresh.has(entry.key)) {
        await db.updateTable('pages').set({ content: JSON.stringify(doc) }).where('id', '=', page.id).execute();
        await db.updateTable('page_versions').set({ content: JSON.stringify(doc) }).where('page_id', '=', page.id).where('version', '=', 1).execute();
        await ctx.queue.add('page.index', { pageId: page.id }, { removeOnComplete: 100, removeOnFail: 500 });
        continue;
      }
      const stored = byKey.get(entry.key)!;
      if (sameDoc(stored.content as JSONContent, doc)) continue;
      // Par le serveur collab: les lecteurs qui ont la page ouverte voient la nouvelle version.
      const reply = await replaceLive(ctx.valkey, page.id, doc, author);
      if (reply === 'timeout' || reply === 'error') throw new Error('Le serveur de collaboration ne répond pas: synchro reportée.');
      if (reply === 'ok') result.updated++;
    }

    // 3. Fichiers disparus: leurs pages vont à la corbeille (restaurables pendant le délai habituel).
    const keep = new Set(list.map((e) => e.key));
    const gone = existing.filter((p) => !p.deleted_at && !keep.has(p.git_path!));
    if (gone.length) {
      await db.updateTable('pages').set({ deleted_at: new Date(), deleted_by: null }).where('id', 'in', gone.map((p) => p.id)).execute();
      result.removed = gone.length;
    }

    await db.updateTable('git_syncs').set({ last_commit: commit, last_synced_at: new Date(), last_error: result.errors.length ? result.errors.slice(0, 5).join(' · ') : null }).where('id', '=', sync.id).execute();
    await collabBroadcast(ctx.valkey, { op: 'tree', requestId: randomUUID() });
    if (gone.length) await collabBroadcast(ctx.valkey, { op: 'access', requestId: randomUUID() });
    return result;
  } catch (error) {
    await db.updateTable('git_syncs').set({ last_error: (error instanceof Error ? error.message : String(error)).slice(0, 500), last_synced_at: new Date() }).where('id', '=', sync.id).execute();
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Réécrit les liens relatifs du Markdown: fichiers .md → /p/<id>, images du dépôt → /api/files/<id>. */
async function rewrite(ctx: GitSyncContext, syncId: string, root: string, file: string, text: string, pageId: string, pageOf: Map<string, { id: string }>): Promise<string> {
  const dir = dirname(file);
  const inside = (target: string) => target === root || target.startsWith(root + sep);
  const keyOf = (target: string) => {
    const rel = relative(root, target).split(sep).join('/');
    const name = posix.basename(rel).toLowerCase();
    return INDEX_FILES.has(name) && posix.dirname(rel) !== '.' ? posix.dirname(rel) : rel;
  };

  // Images: ![alt](chemin "titre")
  const images = [...text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g)];
  for (const match of images) {
    const href = match[2]!;
    if (/^[a-z]+:|^\/\//i.test(href)) continue;
    const target = resolve(dir, decodeURIComponent(href.split('#')[0]!.split('?')[0]!));
    if (!inside(target)) continue;
    const fileId = await uploadAsset(ctx, syncId, root, target, pageId).catch(() => null);
    if (fileId) text = text.replace(match[0], `![${match[1]}](/api/files/${fileId}${match[3] ?? ''})`);
  }

  // Liens vers d'autres fichiers Markdown: [texte](../api/auth.md#ancre)
  return text.replace(/(?<!!)\[([^\]]*)\]\(\s*<?([^)\s>]+\.(?:md|markdown))(#[^)\s>]*)?>?\s*\)/gi, (whole, label: string, href: string) => {
    if (/^[a-z]+:|^\/\//i.test(href)) return whole;
    const target = resolve(dir, decodeURIComponent(href));
    if (!inside(target)) return label;
    const page = pageOf.get(keyOf(target));
    return page ? `[${label}](/p/${page.id})` : label;
  });
}

async function uploadAsset(ctx: GitSyncContext, syncId: string, root: string, target: string, pageId: string): Promise<string | null> {
  if (!ctx.storage) return null;
  const info = await lstat(target).catch(() => null);
  if (!info?.isFile() || info.size > MAX_IMAGE_BYTES) return null;
  const declared = IMAGE_TYPES[extname(target).toLowerCase()];
  if (!declared) return null;
  const body = await readFile(target);
  const contentType = sniffImage(body, declared);
  if (!contentType) return null;
  const path = relative(root, target).split(sep).join('/');
  const sha = createHash('sha256').update(body).digest('hex');
  const known = await ctx.db.selectFrom('git_sync_assets').select(['sha256', 'attachment_id']).where('sync_id', '=', syncId).where('path', '=', path).executeTakeFirst();
  if (known?.sha256 === sha) return known.attachment_id;
  const id = randomUUID();
  const key = `pages/${pageId}/${id}`;
  await ctx.storage.put(key, body, contentType);
  await ctx.db.insertInto('attachments').values({ id, page_id: pageId, name: basename(target), content_type: contentType, size: body.length, storage_key: key, created_by: null }).execute();
  await ctx.db
    .insertInto('git_sync_assets')
    .values({ sync_id: syncId, path, sha256: sha, attachment_id: id })
    .onConflict((oc) => oc.columns(['sync_id', 'path']).doUpdateSet({ sha256: sha, attachment_id: id }))
    .execute();
  return id;
}
