import { HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { readablePages, projectRoleFor, type Database, type Storage, type TreeRow } from '@andal/db';
import type { JSONContent } from '@andal/editor';
import { toHtml } from '@andal/editor/html';
import { toMarkdown } from '@andal/editor/markdown';
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { Kysely } from 'kysely';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { posix } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { DocsService } from '../docs/docs.service.js';
import { config } from '../env.js';
import { DB, STORAGE } from '../infra.module.js';
import { pdfDocument, pdfFooter } from './pdf-template.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Liens que l'export réécrit: pages et fichiers d'Andal, schémas draw.io en data:. */
const LINK = new RegExp(String.raw`\]\((/p/${UUID}|/api/files/${UUID}|data:image/(?:svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/=]+)(?=[\s)])`, 'g');
const VENDOR = new URL('../vendor/', import.meta.url);
const FONTS = ['literata-latin-opsz-normal.woff2', 'literata-latin-opsz-italic.woff2', 'atkinson-hyperlegible-next-latin-wght-normal.woff2', 'atkinson-hyperlegible-mono-latin-400-normal.woff2'];
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' };

/** « Démarrer l'API » → « demarrer-l-api ». */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'page';
}

/** Nom de fichier sûr, accents compris: ni chemin, ni caractère réservé. */
function fileName(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'page';
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function fileIds(doc: JSONContent): string[] {
  const ids = new Set<string>();
  const visit = (node: JSONContent) => {
    if ((node.type === 'image' || node.type === 'attachment') && typeof node.attrs?.fileId === 'string') ids.add(node.attrs.fileId);
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return [...ids];
}

function hasNode(doc: JSONContent, type: string): boolean {
  return doc.type === type || (doc.content ?? []).some((child) => hasNode(child, type));
}

/**
 * Exports: une page en Markdown ou en PDF, un volume entier en archive
 * Markdown (un dossier par page qui a des sous-pages, les fichiers à côté).
 * Seul ce que la personne peut lire part: les droits sont ceux de la page.
 */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(STORAGE) private readonly storage: Storage | null,
    private readonly docs: DocsService,
    private readonly audit: AuditService,
  ) {}

  /** Une page en Markdown, liens et fichiers en adresses complètes vers cette installation. */
  async pageMarkdown(auth: AuthContext, pageId: string) {
    await this.docs.require(auth.subject, pageId, 'page.read');
    const page = await this.db.selectFrom('pages').select(['title', 'content']).where('id', '=', pageId).executeTakeFirstOrThrow();
    const body = `# ${page.title}\n\n${toMarkdown(page.content as JSONContent)}`.replace(LINK, (whole, target: string) => (target.startsWith('/') ? `](${config.webOrigin}${target}` : whole));
    return { name: `${fileName(page.title)}.md`, body };
  }

  /** Une page en PDF, mise en page par Chromium (Gotenberg), diagrammes compris. */
  async pagePdf(auth: AuthContext, pageId: string, ip: string) {
    if (!config.gotenbergUrl) throw new ServiceUnavailableException("L'export PDF n'est pas configuré sur ce serveur (GOTENBERG_URL).");
    const page = await this.docs.page(auth.subject, pageId);
    const locale = auth.user.locale === 'en' ? 'en' : 'fr';
    const doc = page.content;

    // Les images de la page, jointes au formulaire: le moteur PDF n'a pas accès à l'API.
    const form = new FormData();
    const images = new Map<string, string>();
    const ids = fileIds(doc);
    const files = ids.length && this.storage ? await this.db.selectFrom('attachments').select(['id', 'page_id', 'content_type', 'storage_key']).where('id', 'in', ids).execute() : [];
    for (const file of files) {
      const ext = EXTENSIONS[file.content_type];
      if (!ext) continue;
      try {
        await this.docs.require(auth.subject, file.page_id, 'page.read');
        const body = await streamToBuffer(await this.storage!.get(file.storage_key));
        const name = `image-${file.id}.${ext}`;
        form.append('files', new Blob([new Uint8Array(body)], { type: file.content_type }), name);
        images.set(file.id, name);
      } catch {
        // Fichier illisible ou disparu: la figure garde son texte alternatif.
      }
    }

    const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(page.updatedAt));
    const meta =
      locale === 'en'
        ? `v${page.version}, updated ${date}${page.updatedBy ? ` by ${page.updatedBy}` : ''}`
        : `v${page.version}, modifiée le ${date}${page.updatedBy ? ` par ${page.updatedBy}` : ''}`;
    const mermaid = hasNode(doc, 'mermaid');
    const html = pdfDocument({
      locale,
      cloth: page.project.cloth,
      volume: `Vol. ${page.project.volumeNumber} · ${page.project.name}`,
      number: page.number,
      title: page.title,
      summary: page.summary,
      meta,
      mermaid,
      body: toHtml(doc, {
        locale,
        chapter: page.numbering.chapter,
        figureOffset: page.numbering.figureOffset,
        listingOffset: page.numbering.listingOffset,
        fileSrc: (id) => images.get(id) ?? null,
        // Liens internes: vers cette installation, pour qui y a accès.
        linkHref: (href) => (href.startsWith('/') ? `${config.webOrigin}${href}` : null),
      }),
    });
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    form.append('files', new Blob([pdfFooter(`${page.project.shortName} · ${page.number} ${page.title}`)], { type: 'text/html' }), 'footer.html');
    for (const font of FONTS) form.append('files', new Blob([new Uint8Array(await readFile(new URL(font, VENDOR)))], { type: 'font/woff2' }), font);
    if (mermaid) form.append('files', new Blob([new Uint8Array(await readFile(new URL('mermaid.min.js', VENDOR)))], { type: 'text/javascript' }), 'mermaid.min.js');
    // A4, marges de livre (en pouces, l'unité de Gotenberg).
    for (const [key, value] of Object.entries({ paperWidth: '8.27', paperHeight: '11.7', marginTop: '0.75', marginBottom: '0.8', marginLeft: '0.75', marginRight: '0.75', printBackground: 'true', waitForExpression: 'window.andalReady === true', waitDelay: '0s' })) {
      form.append(key, value);
    }

    let response: Response;
    try {
      response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: 'POST', body: form, signal: AbortSignal.timeout(90_000) });
    } catch (error) {
      console.error('Export PDF: Gotenberg injoignable:', error);
      throw new HttpException('Le moteur PDF ne répond pas. Réessayez dans un instant.', 503);
    }
    if (!response.ok) {
      console.error(`Export PDF: Gotenberg a répondu ${response.status}: ${(await response.text()).slice(0, 300)}`);
      throw new HttpException('Le moteur PDF n’a pas pu produire ce document.', 502);
    }
    const body = Buffer.from(await response.arrayBuffer());
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'page.exported', targetType: 'page', targetId: pageId, ip, metadata: { format: 'pdf' } });
    return { name: `${fileName(`${page.number} ${page.title}`)}.pdf`, body };
  }

  /**
   * Le volume en archive Markdown, relisible par l'import d'Andal: une page
   * par fichier (titre et position dans l'en-tête YAML), un dossier par page
   * qui a des sous-pages (son contenu dans index.md), les fichiers dans
   * _fichiers/, les liens entre pages en chemins relatifs.
   */
  async volumeZip(auth: AuthContext, projectId: string, ip: string): Promise<{ name: string; stream: Readable }> {
    const project = await this.db.selectFrom('projects').select(['id', 'slug', 'name', 'workspace_id']).where('id', '=', projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    if (!project || !(await projectRoleFor(this.db, auth.subject, project.id))) throw new NotFoundException();
    const pages = await readablePages(this.db, auth.subject, project.id);
    const visible = new Set(pages.map((p) => p.id));
    const children = new Map<string | null, TreeRow[]>();
    for (const p of pages) {
      const parent = p.parent_id && visible.has(p.parent_id) ? p.parent_id : null;
      children.set(parent, [...(children.get(parent) ?? []), p]);
    }
    // Chemin de chaque page dans l'archive.
    const paths = new Map<string, string>();
    const place = (parent: string | null, dir: string) => {
      (children.get(parent) ?? [])
        .sort((a, b) => a.position - b.position)
        .forEach((page, i) => {
          const base = `${String(i + 1).padStart(2, '0')}-${slugify(page.title)}`;
          const nested = (children.get(page.id) ?? []).length > 0;
          paths.set(page.id, nested ? `${dir}${base}/index.md` : `${dir}${base}.md`);
          if (nested) place(page.id, `${dir}${base}/`);
        });
    };
    place(null, '');

    const rows = pages.length ? await this.db.selectFrom('pages').select(['id', 'content']).where('id', 'in', pages.map((p) => p.id)).execute() : [];
    const contents = new Map(rows.map((r) => [r.id, r.content as JSONContent]));
    const referenced = new Set([...contents.values()].flatMap(fileIds));
    const attachments = referenced.size && this.storage
      ? await this.db.selectFrom('attachments').select(['id', 'page_id', 'name', 'storage_key']).where('id', 'in', [...referenced]).where('page_id', 'in', pages.map((p) => p.id)).execute()
      : [];
    const assets = new Map(attachments.map((a) => [a.id, `_fichiers/${a.id.slice(0, 8)}-${fileName(a.name).replaceAll(' ', '-')}`]));

    const out = new PassThrough();
    const zip = new Zip((error, chunk, final) => {
      if (error) out.destroy(error);
      else {
        out.write(chunk);
        if (final) out.end();
      }
    });
    const root = `${slugify(project.name)}/`;
    const addText = (path: string, text: string) => {
      const entry = new ZipDeflate(root + path, { level: 6 });
      zip.add(entry);
      entry.push(strToU8(text), true);
    };
    const drain = async () => {
      if (out.writableNeedDrain) await once(out, 'drain');
    };

    void (async () => {
      try {
        let drawings = 0;
        for (const page of pages) {
          const path = paths.get(page.id);
          if (!path) continue;
          const dir = posix.dirname(path);
          const relative = (target: string) => posix.relative(dir, target) || posix.basename(target);
          const markdown = toMarkdown(contents.get(page.id) ?? { type: 'doc' }).replace(LINK, (whole, target: string) => {
            if (target.startsWith('/p/')) {
              const linked = paths.get(target.slice(3));
              return `](${linked ? relative(linked) : `${config.webOrigin}${target}`}`;
            }
            if (target.startsWith('/api/files/')) {
              const asset = assets.get(target.slice(11));
              return `](${asset ? relative(asset) : `${config.webOrigin}${target}`}`;
            }
            // Schéma draw.io: son rendu devient un fichier de l'archive.
            const [, mime, data] = /^data:image\/([a-z+]+);base64,(.+)$/.exec(target) ?? [];
            if (!mime || !data) return whole;
            const asset = `_fichiers/schema-${++drawings}.${mime === 'svg+xml' ? 'svg' : mime === 'jpeg' ? 'jpg' : mime}`;
            const entry = new ZipPassThrough(root + asset);
            zip.add(entry);
            entry.push(Buffer.from(data, 'base64'), true);
            return `](${relative(asset)}`;
          });
          addText(path, `---\ntitle: ${yamlString(page.title)}\nposition: ${page.position}\n---\n\n# ${page.title}\n\n${markdown}`);
          await drain();
        }
        for (const file of attachments) {
          const entry = new ZipPassThrough(root + assets.get(file.id)!);
          zip.add(entry);
          try {
            for await (const chunk of await this.storage!.get(file.storage_key)) {
              entry.push(chunk as Uint8Array);
              await drain();
            }
          } catch {
            // Fichier disparu du stockage: l'entrée reste vide plutôt que d'interrompre l'archive.
          }
          entry.push(new Uint8Array(0), true);
        }
        zip.end();
      } catch (error) {
        out.destroy(error as Error);
      }
    })();

    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'project.exported', targetType: 'project', targetId: project.id, ip, metadata: { format: 'markdown', pages: paths.size, files: attachments.length } });
    return { name: `${slugify(project.name)}.zip`, stream: out };
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
