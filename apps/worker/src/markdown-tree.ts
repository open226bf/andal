/**
 * Un dossier de fichiers Markdown vu comme un arbre de pages: commun à la
 * synchro Git et à l'import d'archives (Markdown, Notion, Confluence converti).
 *
 * - chaque fichier .md est une page, chaque sous-dossier une page parente
 *   (son README.md ou index.md en est le contenu);
 * - titre et ordre: en-tête YAML (title, position), sinon premier titre, sinon nom du fichier;
 * - les liens relatifs entre fichiers deviennent des liens entre pages, les
 *   images et fichiers liés partent dans le stockage.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

export const INDEX_FILES = new Set(['readme.md', 'index.md', '_index.md']);

export interface Entry {
  /** Chemin dans le dossier: « api/auth.md », ou « api » pour un dossier. */
  key: string;
  parentKey: string | null;
  /** Fichier Markdown du contenu (absolu); null: dossier sans README. */
  file: string | null;
  title: string;
  position: number;
}

export interface TreeOptions {
  /** Plafond de fichiers Markdown. */
  maxFiles: number;
  maxBytes: number;
  /**
   * « Page.md » à côté d'un dossier « Page/ » en est le contenu (export Notion,
   * archives d'Andal): sinon, deux pages distinctes.
   */
  siblingIndex?: boolean;
}

/** « 02-premiers-pas.md » → « Premiers pas »; « Guide 1a2b…(32) » (Notion) → « Guide ». */
export function prettify(name: string): string {
  const bare = name
    .replace(/\.(md|markdown)$/i, '')
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .replace(/^\d+[-_. ]+/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : name;
}

/** En-tête YAML minimal (« title: … », « position: 3 »), puis le reste du fichier. */
export function frontMatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text.replace(/^﻿/, '') };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2]!.trim();
    // Chaîne entre guillemets doubles: celle qu'écrit l'export d'Andal (JSON).
    if (/^".*"$/.test(value)) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    } else value = value.replace(/^'|'$/g, '');
    meta[kv[1]!.toLowerCase()] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

export function leadingTitle(body: string): string | null {
  return /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body.split(/\r?\n/).find((l) => l.trim()) ?? '')?.[1] ?? null;
}

/** Retire le premier titre s'il redit le titre de la page. */
export function stripLeadingTitle(body: string, title: string): string {
  return body.replace(/^\s*#\s+[^\n]*\n+/, (line) => (line.replace(/^\s*#\s+/, '').trim() === title ? '' : line));
}

/** Les fichiers Markdown du dossier, sans suivre les liens symboliques ni les dossiers cachés. */
export async function walk(root: string, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__MACOSX') continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        out.push(full);
        if (out.length > maxFiles) throw new Error(`Plus de ${maxFiles} fichiers Markdown: choisissez un dossier plus précis.`);
      }
    }
  };
  await visit(root);
  return out;
}

/** La clé (page) d'un fichier: le dossier dont il est l'index, sinon son propre chemin. */
export function keyOfFile(rel: string, dirs: Set<string>, siblingIndex: boolean): string {
  const dirKey = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);
  if (INDEX_FILES.has(posix.basename(rel).toLowerCase()) && dirKey !== '') return dirKey;
  const bare = rel.replace(/\.(md|markdown)$/i, '');
  return siblingIndex && dirs.has(bare) ? bare : rel;
}

/** Fichiers → entrées (pages), dossiers compris, avec titres et positions. */
export async function entries(root: string, files: string[], options: TreeOptions): Promise<Entry[]> {
  const rels = files.map((file) => relative(root, file).split(sep).join('/'));
  // Les dossiers qui contiennent au moins un fichier Markdown, à toute profondeur.
  const dirs = new Set<string>();
  for (const rel of rels) for (let d = posix.dirname(rel); d !== '.'; d = posix.dirname(d)) dirs.add(d);
  const byKey = new Map<string, Entry & { order: string; indexed: boolean }>();
  const ensureDir = (dirKey: string) => {
    if (!dirKey || byKey.has(dirKey)) return;
    const parent = posix.dirname(dirKey);
    ensureDir(parent === '.' ? '' : parent);
    byKey.set(dirKey, { key: dirKey, parentKey: parent === '.' ? null : parent, file: null, title: prettify(posix.basename(dirKey)), position: Number.NaN, order: posix.basename(dirKey), indexed: false });
  };
  // Les README et index.md d'abord: ils l'emportent sur un « Page.md » voisin, qui reste alors une page à part.
  const ordered = files.map((file, i) => ({ file, rel: rels[i]! })).sort((a, b) => Number(!INDEX_FILES.has(posix.basename(a.rel).toLowerCase())) - Number(!INDEX_FILES.has(posix.basename(b.rel).toLowerCase())));
  for (const { file, rel } of ordered) {
    let key = keyOfFile(rel, dirs, options.siblingIndex ?? false);
    if (key !== rel && byKey.get(key)?.indexed) key = rel;
    const isIndex = key !== rel;
    const parentDir = isIndex ? posix.dirname(key) : posix.dirname(rel);
    const parentKey = parentDir === '.' ? null : parentDir;
    if (parentKey) ensureDir(parentKey);
    if (isIndex) ensureDir(key);
    const existing = byKey.get(key);
    const text = (await readFile(file, 'utf8')).slice(0, options.maxBytes);
    const { meta, body } = frontMatter(text);
    const name = isIndex ? posix.basename(key) : posix.basename(rel);
    byKey.set(key, {
      key,
      parentKey,
      file,
      title: (meta.title || leadingTitle(body) || prettify(name)).slice(0, 200),
      position: meta.position !== undefined || meta.order !== undefined ? Number(meta.position ?? meta.order) : Number.NaN,
      order: existing?.order ?? name,
      indexed: isIndex,
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
  return list
    .map(({ key, parentKey, file, title, position }) => ({ key, parentKey, file, title, position }))
    .sort((a, b) => a.key.split('/').length - b.key.split('/').length || a.position - b.position);
}

export interface RewriteContext {
  /** Dossier des fichiers Markdown (les clés des pages en partent). */
  root: string;
  /** Dossier d'où les fichiers liés peuvent venir (souvent le même). */
  assets: string;
  pageOf: Map<string, { id: string }>;
  dirs: Set<string>;
  siblingIndex: boolean;
  /** Envoie une image; renvoie l'identifiant du fichier, ou null s'il n'est pas repris. */
  image: (target: string) => Promise<string | null>;
  /** Envoie un fichier lié (PDF, archive…), avec le texte du lien; absent: le lien reste du texte. */
  file?: (target: string, label: string) => Promise<string | null>;
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:|^\/\/|^#/i;

/** Réécrit les liens relatifs du Markdown: fichiers .md → /p/<id>, images et fichiers → /api/files/<id>. */
export async function rewriteLinks(ctx: RewriteContext, file: string, text: string): Promise<string> {
  const dir = dirname(file);
  const inside = (base: string, target: string) => target === base || target.startsWith(base + sep);
  const decode = (href: string) => {
    try {
      return decodeURIComponent(href);
    } catch {
      return href;
    }
  };
  const target = (href: string) => resolve(dir, decode(href.split('#')[0]!.split('?')[0]!));

  // Images: ![alt](chemin "titre")
  for (const match of [...text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g)]) {
    const href = match[2]!;
    if (EXTERNAL.test(href)) continue;
    const path = target(href);
    if (!inside(ctx.assets, path)) continue;
    const fileId = await ctx.image(path).catch(() => null);
    if (fileId) text = text.replace(match[0], `![${match[1]}](/api/files/${fileId}${match[3] ?? ''})`);
  }

  // Liens vers d'autres fichiers Markdown: [texte](../api/auth.md#ancre)
  text = text.replace(/(?<!!)\[([^\]]*)\]\(\s*<?([^)\s>]+\.(?:md|markdown))(#[^)\s>]*)?>?\s*\)/gi, (whole, label: string, href: string) => {
    if (EXTERNAL.test(href)) return whole;
    const path = target(href);
    if (!inside(ctx.root, path)) return label;
    const page = ctx.pageOf.get(keyOfFile(relative(ctx.root, path).split(sep).join('/'), ctx.dirs, ctx.siblingIndex));
    return page ? `[${label}](/p/${page.id})` : label;
  });

  // Autres fichiers liés (PDF, tableur, archive…): pièce jointe, si l'import le permet.
  if (ctx.file) {
    for (const match of [...text.matchAll(/(?<!!)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)/g)]) {
      const href = match[2]!;
      if (EXTERNAL.test(href) || href.startsWith('/') || /\.(md|markdown)(#.*)?$/i.test(href)) continue;
      const path = target(href);
      if (!inside(ctx.assets, path)) continue;
      const fileId = await ctx.file(path, match[1]!).catch(() => null);
      text = text.replace(match[0], fileId ? `[${match[1]}](/api/files/${fileId})` : match[1]!);
    }
  }
  return text;
}

/** Les dossiers qui contiennent du Markdown, pour reconnaître « Page.md » + « Page/ ». */
export function markdownDirs(root: string, files: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const file of files) for (let d = posix.dirname(relative(root, file).split(sep).join('/')); d !== '.'; d = posix.dirname(d)) dirs.add(d);
  return dirs;
}
