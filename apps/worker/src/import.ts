/**
 * Import d'une archive dans un volume: Markdown (fichier seul ou dossier zippé,
 * archives d'Andal comprises), export Notion (Markdown & CSV) ou export HTML
 * d'un espace Confluence.
 *
 * L'archive est déballée dans un dossier temporaire, sans rien suivre hors de
 * lui (chemins « .. », liens symboliques) et sous plafond de taille; tout est
 * ramené à un dossier de Markdown, puis chaque fichier devient une page sous
 * la destination choisie. Les pages importées sont des pages ordinaires,
 * modifiables tout de suite.
 */
import { collabBroadcast, linkSpecBlocks, ltreeLabel, sniffImage, type Database, type ImportSource, type Storage } from '@andal/db';
import { validateDoc, type JSONContent } from '@andal/editor';
import { fromMarkdown } from '@andal/editor/markdown';
import { createDocument } from '@mixmark-io/domino';
import type { Queue } from 'bullmq';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { ancestor, htmlToMarkdown, pageParts } from './html-markdown.js';
import { entries, frontMatter, markdownDirs, rewriteLinks, stripLeadingTitle, walk } from './markdown-tree.js';

const MAX_PAGES = 2000;
const MAX_ENTRIES = 10_000;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
/** Dossier des pages converties (Confluence, HTML), à côté des fichiers de l'export. */
const TREE = '.andal-tree';

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
const FILE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.xml': 'application/xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export interface ImportContext {
  db: Kysely<Database>;
  valkey: Redis;
  queue: Queue;
  storage: Storage | null;
  /** Taille maximale d'un fichier repris (images, pièces jointes), comme pour un envoi. */
  fileMaxBytes: number;
  /** Taille maximale de l'archive déballée. */
  unpackedMaxBytes: number;
}

type Messages = { attachments: string };
const MESSAGES: Record<'fr' | 'en', Messages> = { fr: { attachments: 'Pièces jointes' }, en: { attachments: 'Attachments' } };

/* ---------- Déballage ---------- */

/** Chemin sûr dans l'archive: ni absolu, ni « .. », ni fichiers parasites (macOS). */
function safeName(name: string): string | null {
  const clean = posix.normalize(name.replaceAll('\\', '/').replace(/^\/+/, ''));
  if (!clean || clean === '.' || clean.startsWith('..') || clean.includes('\0')) return null;
  if (clean.split('/').some((part) => part === '__MACOSX' || part === '.DS_Store' || part === TREE)) return null;
  return clean;
}

/**
 * Déballe un zip par lots d'au plus 64 Mo (jamais tout en mémoire), sous
 * plafond d'entrées et de taille totale: une « bombe » s'arrête au plafond.
 */
async function unzip(data: Uint8Array, dest: string, budget: { bytes: number }): Promise<void> {
  const listed: { name: string; size: number }[] = [];
  unzipSync(data, {
    filter: (file: UnzipFileInfo) => {
      if (!file.name.endsWith('/') && safeName(file.name)) listed.push({ name: file.name, size: file.originalSize });
      return false;
    },
  });
  if (listed.length > MAX_ENTRIES) throw new Error(`L’archive contient plus de ${MAX_ENTRIES} fichiers.`);
  if (listed.reduce((sum, f) => sum + f.size, 0) > budget.bytes) throw new Error('L’archive déballée dépasse la taille permise.');
  const batches: Set<string>[] = [];
  let current = new Set<string>();
  let size = 0;
  for (const file of listed) {
    if (current.size && size + file.size > 64 * 1024 * 1024) {
      batches.push(current);
      current = new Set();
      size = 0;
    }
    current.add(file.name);
    size += file.size;
  }
  if (current.size) batches.push(current);
  for (const batch of batches) {
    const out = unzipSync(data, { filter: (file) => batch.has(file.name) });
    for (const [name, body] of Object.entries(out)) {
      budget.bytes -= body.length;
      if (budget.bytes < 0) throw new Error('L’archive déballée dépasse la taille permise.');
      const target = join(dest, safeName(name)!);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    }
  }
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === TREE) continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  await visit(root);
  return out;
}

/** Un seul dossier à la racine (« mon-espace/… »): c'est lui, la racine. */
async function unwrap(root: string): Promise<string> {
  const items = (await readdir(root, { withFileTypes: true })).filter((e) => !e.name.startsWith('.') && e.name !== '__MACOSX');
  return items.length === 1 && items[0]!.isDirectory() ? unwrap(join(root, items[0]!.name)) : root;
}

/** L'export Notion arrive parfois en plusieurs zips dans un zip: on les déballe à leur tour. */
async function nestedZips(root: string, budget: { bytes: number }): Promise<void> {
  const files = (await readdir(root, { withFileTypes: true })).filter((e) => e.isFile() && !e.name.startsWith('.'));
  if (files.length === 0 || !files.every((f) => /\.zip$/i.test(f.name))) return;
  for (const file of files) {
    const path = join(root, file.name);
    await unzip(await readFile(path), join(root, file.name.replace(/\.zip$/i, '')), budget);
    await rm(path);
  }
}

/* ---------- Reconnaître et convertir ---------- */

async function detect(root: string): Promise<ImportSource> {
  const files = await listFiles(root);
  const html = files.filter((f) => /\.html?$/i.test(f));
  const markdown = files.filter((f) => /\.(md|markdown)$/i.test(f));
  for (const file of html.slice(0, 30)) {
    const text = await readFile(file, 'utf8');
    if (/id="main-content"/.test(text) && /confluence|breadcrumb-section|id="title-text"/i.test(text)) return 'confluence';
  }
  if (html.length > 0 && markdown.length === 0) return 'html';
  if (markdown.some((f) => /\s[0-9a-f]{32}\.(md|markdown)$/i.test(basename(f)))) return 'notion';
  return 'markdown';
}

/** Chemin relatif utilisable dans un lien Markdown: segments encodés, séparateurs gardés. */
function linkPath(from: string, to: string): string {
  return relative(dirname(from), to).split(sep).map(encodeURIComponent).join('/');
}

function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  );
}

interface HtmlPage {
  file: string;
  title: string;
  parent: string | null;
  position: number;
  body: string;
}

/**
 * Pages HTML → dossier de Markdown (.andal-tree), une page par fichier, la
 * hiérarchie de l'index Confluence en dossiers. Les liens entre pages et vers
 * les fichiers de l'export deviennent des chemins relatifs, que l'import
 * réécrit ensuite comme pour n'importe quel Markdown.
 */
async function htmlTree(root: string, source: 'confluence' | 'html', locale: 'fr' | 'en', warnings: string[]): Promise<string> {
  const files = (await listFiles(root)).filter((f) => /\.html?$/i.test(f));
  const pages = new Map<string, HtmlPage>();
  for (const file of files) {
    const doc = createDocument(await readFile(file, 'utf8'));
    const { title, body } = pageParts(doc);
    // L'index d'un export Confluence n'est pas une page: c'est le sommaire.
    if (source === 'confluence' && basename(file).toLowerCase() === 'index.html' && !doc.querySelector('#main-content')) continue;
    // Confluence liste les pièces jointes sous le contenu: on les garde, en liens vers les fichiers.
    const attachments = Array.from(doc.querySelectorAll('.pageSection a[href^="attachments/"]'))
      .map((a) => ({ href: a.getAttribute('href') ?? '', name: a.textContent?.trim() ?? '' }))
      .filter((a) => a.href && !body.includes(a.href) && !IMAGE_TYPES[extname(a.href).toLowerCase()]);
    const extra = attachments.length ? `<h2>${MESSAGES[locale].attachments}</h2>${attachments.map((a) => `<p><a href="${a.href}">${a.name.replaceAll('<', '&lt;')}</a></p>`).join('')}` : '';
    pages.set(file, { file, title: title || basename(file).replace(/\.html?$/i, '').replace(/_\d+$/, '').replace(/[-_]+/g, ' '), parent: null, position: Number.MAX_SAFE_INTEGER, body: body + extra });
  }

  // La hiérarchie: les listes imbriquées de index.html (Confluence), sinon les pages à plat.
  const index = files.find((f) => basename(f).toLowerCase() === 'index.html');
  if (source === 'confluence' && index) {
    const doc = createDocument(await readFile(index, 'utf8'));
    const dir = dirname(index);
    const order = new Map<string | null, number>();
    const anchor = (li: Element) => Array.from(li.childNodes).find((c) => c.nodeName === 'A') as Element | undefined;
    for (const li of Array.from(doc.querySelectorAll('li'))) {
      const href = anchor(li)?.getAttribute('href');
      const page = href ? pages.get(resolve(dir, decodeURIComponent(href))) : undefined;
      if (!page) continue;
      const parentLi = ancestor(li, 'LI');
      const parentHref = parentLi ? anchor(parentLi)?.getAttribute('href') : null;
      const parent = parentHref ? resolve(dir, decodeURIComponent(parentHref)) : null;
      page.parent = parent && pages.has(parent) ? parent : null;
      page.position = (order.get(page.parent) ?? 0) + 1;
      order.set(page.parent, page.position);
    }
  }

  // Chemins dans .andal-tree: « 01-titre.md », ou « 01-titre/index.md » pour une page qui a des sous-pages.
  const tree = join(root, TREE);
  const children = new Map<string | null, HtmlPage[]>();
  for (const page of pages.values()) children.set(page.parent, [...(children.get(page.parent) ?? []), page]);
  const target = new Map<string, string>();
  const place = (parent: string | null, dir: string) => {
    (children.get(parent) ?? [])
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, 'fr', { numeric: true }))
      .forEach((page, i) => {
        const base = `${String(i + 1).padStart(2, '0')}-${slugify(page.title)}`;
        const nested = (children.get(page.file) ?? []).length > 0;
        target.set(page.file, nested ? join(dir, base, 'index.md') : join(dir, `${base}.md`));
        page.position = i + 1;
        if (nested) place(page.file, join(dir, base));
      });
  };
  place(null, tree);

  for (const page of pages.values()) {
    const out = target.get(page.file)!;
    const from = dirname(page.file);
    const markdown = htmlToMarkdown(page.body, {
      page: (href) => {
        if (/^[a-z]+:|^\/\/|^#/i.test(href)) return null;
        const linked = target.get(resolve(from, decodeURIComponent(href.split('#')[0]!)));
        return linked ? linkPath(out, linked) : null;
      },
      asset: (href) => {
        if (!href || /^[a-z]+:|^\/\/|^#/i.test(href)) return null;
        const path = resolve(from, decodeURIComponent(href.split('#')[0]!.split('?')[0]!));
        if (path !== root && !path.startsWith(root + sep)) return null;
        // Icônes de l'interface Confluence (puces, émoticônes): sans intérêt dans une page.
        if (/(^|\/)images\/icons\//.test(relative(root, path).split(sep).join('/'))) return null;
        return linkPath(out, path);
      },
    });
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `---\ntitle: ${JSON.stringify(page.title)}\nposition: ${page.position}\n---\n\n${markdown}\n`);
  }
  if (pages.size === 0) warnings.push('Aucune page HTML lisible dans l’archive.');
  return tree;
}

/** Une base Notion (CSV) devient une page avec son tableau, posée comme parente de ses lignes. */
async function notionTables(root: string): Promise<void> {
  for (const file of (await listFiles(root)).filter((f) => /\.csv$/i.test(f) && !/_all\.csv$/i.test(f))) {
    const md = file.replace(/\.csv$/i, '.md');
    if (await lstat(md).catch(() => null)) continue;
    const rows = parseCsv((await readFile(file, 'utf8')).replace(/^﻿/, '')).slice(0, 500);
    if (rows.length === 0) continue;
    const width = Math.max(...rows.map((r) => r.length));
    const cell = (v: string | undefined) => (v ?? '').replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
    const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`;
    const table = [line(rows[0]!), line(Array<string>(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
    await writeFile(md, `# ${basename(file).replace(/\.csv$/i, '').replace(/\s+[0-9a-f]{32}$/i, '')}\n\n${table}\n`);
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || (c === '\r' && text[i + 1] === '\n')) {
      if (c === '\r') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((v) => v.trim()));
}

/** Les encadrés de Notion (<aside>…</aside> dans son Markdown) en encadrés d'Andal. */
function notionMarkdown(text: string): string {
  return text.replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_m, inner: string) => {
    const lines = inner.trim().split(/\r?\n/);
    // Le premier caractère est souvent l'icône choisie dans Notion (💡, ⚠️…).
    const first = lines[0]!.replace(/^\p{Extended_Pictographic}️?\s*/u, '');
    return ['> [!NOTE]', `> ${first}`, ...lines.slice(1).map((l) => (l.trim() ? `> ${l}` : '>'))].join('\n');
  });
}

/* ---------- Pages ---------- */

interface Imported {
  pages: number;
  files: number;
  firstPageId: string | null;
}

async function createPages(
  ctx: ImportContext,
  imp: { id: string; project_id: string; parent_id: string | null; created_by: string | null },
  tree: string,
  assets: string,
  options: { siblingIndex: boolean; notion: boolean },
  warnings: string[],
): Promise<Imported> {
  const { db } = ctx;
  const files = await walk(tree, MAX_PAGES);
  if (files.length === 0) throw new Error('Aucune page à importer: l’archive ne contient ni Markdown, ni page HTML.');
  const list = await entries(tree, files, { maxFiles: MAX_PAGES, maxBytes: MAX_MARKDOWN_BYTES, siblingIndex: options.siblingIndex });
  const dirs = markdownDirs(tree, files);
  const author = imp.created_by;

  // La destination: la page choisie si elle est toujours là, sinon le premier niveau du volume.
  const parent = imp.parent_id ? await db.selectFrom('pages').select(['id', 'path']).where('id', '=', imp.parent_id).where('deleted_at', 'is', null).executeTakeFirst() : null;
  if (imp.parent_id && !parent) warnings.push('La page de destination a disparu: les pages sont au premier niveau du volume.');
  const base = Number(
    (
      await db
        .selectFrom('pages')
        .select((eb) => eb.fn.max('position').as('m'))
        .where('project_id', '=', imp.project_id)
        .where((eb) => (parent ? eb('parent_id', '=', parent.id) : eb('parent_id', 'is', null)))
        .executeTakeFirst()
    )?.m ?? 0,
  );

  // 1. L'arbre, parentes d'abord.
  const pageOf = new Map<string, { id: string; path: string }>();
  let firstPageId: string | null = null;
  for (const entry of list) {
    const above = entry.parentKey ? pageOf.get(entry.parentKey) : parent;
    const id = randomUUID();
    const path = above ? `${above.path}.${ltreeLabel(id)}` : ltreeLabel(id);
    await db
      .insertInto('pages')
      .values({ id, project_id: imp.project_id, parent_id: above?.id ?? null, path, position: entry.parentKey ? entry.position : base + entry.position, title: entry.title, content: JSON.stringify(EMPTY_DOC), updated_by: author })
      .execute();
    pageOf.set(entry.key, { id, path });
    if (!entry.parentKey && entry.position === 1) firstPageId = id;
  }

  // 2. Le contenu: liens relatifs → pages, images et fichiers → stockage.
  const uploaded = new Map<string, string | null>();
  const stored = new Map<string, { size: number; contentType: string }>();
  // Nom affiché: celui du lien s'il en a l'air (Confluence range ses fichiers sous leur identifiant), sinon celui du fichier.
  const upload = async (target: string, pageId: string, image: boolean, label = ''): Promise<string | null> => {
    const known = uploaded.get(target);
    if (known !== undefined) return known;
    let id: string | null = null;
    if (ctx.storage) {
      const info = await lstat(target).catch(() => null);
      if (info?.isFile() && info.size > 0 && info.size <= ctx.fileMaxBytes) {
        const ext = extname(target).toLowerCase();
        const body = await readFile(target);
        const imageType = sniffImage(body, IMAGE_TYPES[ext] ?? 'application/octet-stream');
        if (image ? imageType : true) {
          id = randomUUID();
          const contentType = imageType ?? FILE_TYPES[ext] ?? 'application/octet-stream';
          const key = `pages/${pageId}/${id}`;
          await ctx.storage.put(key, body, contentType);
          const name = /^[^/\\]+\.[a-z0-9]{1,8}$/i.test(label.trim()) ? label.trim() : basename(target);
          await db.insertInto('attachments').values({ id, page_id: pageId, name: name.slice(0, 180), content_type: contentType, size: body.length, storage_key: key, created_by: author }).execute();
          stored.set(id, { size: body.length, contentType });
        }
      } else if (info?.isFile() && info.size > ctx.fileMaxBytes) {
        warnings.push(`${relative(assets, target)}: trop lourd, laissé de côté.`);
      }
    }
    uploaded.set(target, id);
    return id;
  };

  for (const entry of list) {
    const page = pageOf.get(entry.key)!;
    let doc: JSONContent = EMPTY_DOC;
    if (entry.file) {
      const { body } = frontMatter((await readFile(entry.file, 'utf8')).slice(0, MAX_MARKDOWN_BYTES));
      const text = stripLeadingTitle(options.notion ? notionMarkdown(body) : body, entry.title);
      const markdown = await rewriteLinks(
        {
          root: tree,
          assets,
          pageOf,
          dirs,
          siblingIndex: options.siblingIndex,
          image: (target) => upload(target, page.id, true),
          file: (target, label) => upload(target, page.id, false, label),
        },
        entry.file,
        text,
      );
      doc = await linkSpecBlocks(db, imp.project_id, withFileDetails(fromMarkdown(markdown), stored));
      const problem = validateDoc(doc);
      if (problem) {
        warnings.push(`${relative(tree, entry.file)}: ${problem}`);
        doc = EMPTY_DOC;
      }
    }
    await db.updateTable('pages').set({ content: JSON.stringify(doc) }).where('id', '=', page.id).execute();
    await db.insertInto('page_versions').values({ page_id: page.id, version: 1, title: entry.title, content: JSON.stringify(doc), authors: JSON.stringify(author ? [author] : []) }).execute();
    await ctx.queue.add('page.index', { pageId: page.id }, { removeOnComplete: 100, removeOnFail: 500 });
  }
  return { pages: list.length, files: [...uploaded.values()].filter(Boolean).length, firstPageId };
}

/** La fiche d'une pièce jointe affiche taille et type: le Markdown ne les porte pas, le stockage si. */
function withFileDetails(node: JSONContent, stored: Map<string, { size: number; contentType: string }>): JSONContent {
  const details = node.type === 'attachment' ? stored.get(String(node.attrs?.fileId ?? '')) : undefined;
  return {
    ...node,
    ...(details ? { attrs: { ...node.attrs, size: details.size, contentType: details.contentType } } : {}),
    ...(node.content ? { content: node.content.map((child) => withFileDetails(child, stored)) } : {}),
  };
}

/* ---------- La tâche ---------- */

export async function runImport(ctx: ImportContext, importId: string): Promise<void> {
  const { db } = ctx;
  const imp = await db
    .selectFrom('imports as i')
    .leftJoin('users as u', 'u.id', 'i.created_by')
    .selectAll('i')
    .select(['u.locale'])
    .where('i.id', '=', importId)
    .executeTakeFirst();
  if (!imp || imp.status !== 'pending') return;
  await db.updateTable('imports').set({ status: 'running' }).where('id', '=', imp.id).execute();

  const work = await mkdtemp(join(tmpdir(), 'andal-import-'));
  const warnings: string[] = [];
  try {
    if (!ctx.storage) throw new Error('Le stockage des fichiers n’est pas configuré.');
    const chunks: Buffer[] = [];
    for await (const chunk of await ctx.storage.get(imp.storage_key)) chunks.push(Buffer.from(chunk as Uint8Array));
    const archive = Buffer.concat(chunks);

    const unpacked = join(work, 'src');
    await mkdir(unpacked);
    const budget = { bytes: ctx.unpackedMaxBytes };
    const name = basename(imp.file_name).replace(/[\\/]/g, '_') || 'import';
    if (archive.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) await unzip(archive, unpacked, budget);
    else if (/\.(md|markdown|html?)$/i.test(name)) await writeFile(join(unpacked, name), archive);
    else throw new Error('Format non reconnu: envoyez une archive .zip, un fichier .md ou une page .html.');

    let root = await unwrap(unpacked);
    await nestedZips(root, budget);
    root = await unwrap(root);
    const source = await detect(root);
    const locale = imp.locale === 'en' ? 'en' : 'fr';

    let tree = root;
    if (source === 'confluence' || source === 'html') tree = await htmlTree(root, source, locale, warnings);
    if (source === 'notion') await notionTables(root);

    const result = await createPages(ctx, imp, tree, root, { siblingIndex: true, notion: source === 'notion' }, warnings);
    await db
      .updateTable('imports')
      .set({ status: 'done', source, pages: result.pages, files: result.files, first_page_id: result.firstPageId, warnings: JSON.stringify(warnings.slice(0, 50)), finished_at: new Date() })
      .where('id', '=', imp.id)
      .execute();
    await db
      .insertInto('audit_events')
      .values({ workspace_id: imp.workspace_id, actor_id: imp.created_by, action: 'import.finished', target_type: 'project', target_id: imp.project_id, ip: null, metadata: JSON.stringify({ importId: imp.id, source, pages: result.pages, files: result.files, file: imp.file_name }) })
      .execute();
    await collabBroadcast(ctx.valkey, { op: 'tree', requestId: randomUUID() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.updateTable('imports').set({ status: 'failed', error: message.slice(0, 500), warnings: JSON.stringify(warnings.slice(0, 50)), finished_at: new Date() }).where('id', '=', imp.id).execute();
  } finally {
    await rm(work, { recursive: true, force: true });
    // L'archive ne sert plus: elle quitte le stockage, réussite ou non.
    await ctx.storage?.remove([imp.storage_key]).catch(() => undefined);
  }
}

/** Imports restés « en cours » (worker arrêté au milieu): ils échouent proprement au démarrage. */
export async function abandonStaleImports(db: Kysely<Database>): Promise<void> {
  await db
    .updateTable('imports')
    .set({ status: 'failed', error: 'Import interrompu (le worker s’est arrêté). Relancez-le.', finished_at: new Date() })
    .where('status', '=', 'running')
    .where(sql<boolean>`created_at < now() - interval '1 minute'`)
    .execute();
}
