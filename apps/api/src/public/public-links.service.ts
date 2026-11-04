import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { can } from '@andal/authz';
import { projectRoleFor, type Database, type Storage } from '@andal/db';
import { pageIdFromHref, type JSONContent } from '@andal/editor';
import { sql, type Kysely } from 'kysely';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { compareNumbers, DocsService } from '../docs/docs.service.js';
import { config } from '../env.js';
import { DB, STORAGE } from '../infra.module.js';

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

interface SharedPage {
  id: string;
  parent_id: string | null;
  path: string;
  position: number;
  title: string;
}

export interface LinkView {
  id: string;
  token: string;
  url: string;
  /** null: tout le volume. */
  page: { id: string; title: string } | null;
  subpages: boolean;
  createdAt: string;
  createdBy: string | null;
}

/**
 * Liens publics en lecture: une page (avec ou sans ses sous-pages) ou tout un
 * volume, lisibles sans compte à l'adresse /s/<jeton>. Les admins du volume
 * les créent et les retirent. Une page restreinte en lecture n'est jamais
 * publique, ni elle ni ses sous-pages, même si la restriction arrive après le
 * lien: elle disparaît du partage aussitôt.
 */
@Injectable()
export class PublicLinksService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(STORAGE) private readonly storage: Storage | null,
    private readonly docs: DocsService,
    private readonly audit: AuditService,
  ) {}

  private view(row: { id: string; token: string; page_id: string | null; page_title: string | null; subpages: boolean; created_at: Date; created_by_name: string | null }): LinkView {
    return {
      id: row.id,
      token: row.token,
      url: `${config.webOrigin}/s/${row.token}`,
      page: row.page_id ? { id: row.page_id, title: row.page_title ?? '' } : null,
      subpages: row.subpages,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by_name,
    };
  }

  private links() {
    return this.db
      .selectFrom('public_links as l')
      .leftJoin('pages as p', 'p.id', 'l.page_id')
      .leftJoin('users as u', 'u.id', 'l.created_by')
      .select(['l.id', 'l.token', 'l.page_id', 'p.title as page_title', 'l.subpages', 'l.created_at', 'u.name as created_by_name', 'l.project_id']);
  }

  /** La page ou une de ses parentes est-elle restreinte en lecture ? */
  private async viewRestricted(pageId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('page_restrictions as r')
      .innerJoin('pages as a', 'a.id', 'r.page_id')
      .select('r.page_id')
      .where('r.kind', '=', 'view')
      .where(sql<boolean>`a.path @> (select path from pages where id = ${pageId})`)
      .executeTakeFirst();
    return Boolean(row);
  }

  /** Pour le panneau Partager: les liens qui couvrent cette page, et ce qu'on peut en faire. */
  async status(auth: AuthContext, pageId: string) {
    const access = await this.docs.require(auth.subject, pageId, 'page.read');
    const page = await this.db.selectFrom('pages').select(['id', 'path', 'title']).where('id', '=', pageId).executeTakeFirstOrThrow();
    const rows = await this.links()
      .where('l.project_id', '=', access.projectId)
      // Le volume, la page elle-même, ou une parente partagée avec ses sous-pages.
      .where(sql<boolean>`(l.page_id is null or l.page_id = ${pageId} or (l.subpages and p.path @> ${page.path}::ltree))`)
      .execute();
    const restricted = await this.viewRestricted(pageId);
    return {
      enabled: config.publicLinks,
      canManage: can(access.role, 'project.share'),
      restricted,
      // Une page restreinte n'est servie par aucun lien, même s'il existe.
      links: rows.map((r) => this.view(r)).sort((a, b) => Number(a.page === null) - Number(b.page === null)),
    };
  }

  /** `{ pageId, subpages }` pour une page, `{ projectId }` pour tout le volume. Recréer un lien existant le met à jour. */
  async create(auth: AuthContext, input: { pageId?: unknown; projectId?: unknown; subpages?: unknown }, ip: string): Promise<LinkView> {
    if (!config.publicLinks) throw new ForbiddenException('Les liens publics sont désactivés sur ce serveur (PUBLIC_LINKS).');
    const subpages = input.subpages !== false;
    let projectId: string;
    let pageId: string | null = null;
    if (typeof input.pageId === 'string') {
      const access = await this.docs.require(auth.subject, input.pageId, 'page.read');
      if (!can(access.role, 'project.share')) throw new ForbiddenException('Seuls les admins du volume publient un lien public.');
      if (await this.viewRestricted(input.pageId)) throw new ConflictException('Cette page est restreinte en lecture : elle ne peut pas être publique. Levez d’abord la restriction.');
      projectId = access.projectId;
      pageId = input.pageId;
    } else if (typeof input.projectId === 'string') {
      const project = await this.db.selectFrom('projects').select('id').where('id', '=', input.projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
      const role = project ? await projectRoleFor(this.db, auth.subject, project.id) : null;
      if (!project || !role) throw new NotFoundException();
      if (!can(role, 'project.share')) throw new ForbiddenException('Seuls les admins du volume publient un lien public.');
      projectId = project.id;
    } else {
      throw new BadRequestException('Indiquez la page (pageId) ou le volume (projectId) à publier.');
    }

    const existing = await this.db
      .selectFrom('public_links')
      .select(['id'])
      .where('project_id', '=', projectId)
      .where((eb) => (pageId ? eb('page_id', '=', pageId) : eb('page_id', 'is', null)))
      .executeTakeFirst();
    let id: string;
    if (existing) {
      await this.db.updateTable('public_links').set({ subpages }).where('id', '=', existing.id).execute();
      id = existing.id;
    } else {
      const row = await this.db
        .insertInto('public_links')
        .values({ token: randomBytes(18).toString('base64url'), workspace_id: auth.user.workspace_id, project_id: projectId, page_id: pageId, subpages, created_by: auth.user.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      id = row.id;
    }
    await this.audit.record({
      workspaceId: auth.user.workspace_id,
      actorId: auth.user.id,
      action: existing ? 'public_link.updated' : 'public_link.created',
      targetType: pageId ? 'page' : 'project',
      targetId: pageId ?? projectId,
      ip,
      metadata: { linkId: id, subpages },
    });
    return this.view(await this.links().where('l.id', '=', id).executeTakeFirstOrThrow());
  }

  async remove(auth: AuthContext, linkId: string, ip: string) {
    const link = await this.db.selectFrom('public_links').selectAll().where('id', '=', linkId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    if (!link) throw new NotFoundException();
    const role = await projectRoleFor(this.db, auth.subject, link.project_id);
    if (!role) throw new NotFoundException();
    if (!can(role, 'project.share')) throw new ForbiddenException('Seuls les admins du volume retirent un lien public.');
    await this.db.deleteFrom('public_links').where('id', '=', link.id).execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'public_link.removed', targetType: link.page_id ? 'page' : 'project', targetId: link.page_id ?? link.project_id, ip, metadata: { linkId: link.id } });
  }

  /* ---------- Lecture sans compte ---------- */

  private async resolve(token: string) {
    if (!config.publicLinks || !TOKEN.test(token)) throw new NotFoundException();
    const link = await this.db.selectFrom('public_links').selectAll().where('token', '=', token).executeTakeFirst();
    if (!link) throw new NotFoundException();
    const pages = await this.sharedPages(link);
    if (pages.length === 0) throw new NotFoundException();
    return { link, pages };
  }

  /** Les pages servies par un lien: hors corbeille, hors restriction de lecture (la page ou une parente). */
  private async sharedPages(link: { project_id: string; page_id: string | null; subpages: boolean }): Promise<SharedPage[]> {
    let query = this.db
      .selectFrom('pages')
      .select(['id', 'parent_id', 'path', 'position', 'title'])
      .where('project_id', '=', link.project_id)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`not exists (select 1 from page_restrictions r join pages a on a.id = r.page_id where r.kind = 'view' and a.path @> pages.path)`);
    if (link.page_id) {
      const root = link.page_id;
      query = link.subpages
        ? query.where(sql<boolean>`path <@ (select path from pages where id = ${root})`)
        : query.where('id', '=', root);
    }
    return query.orderBy('position').execute();
  }

  /** Le partage: son titre, le volume, et le sommaire des pages publiques, numéros compris. */
  async tree(token: string) {
    const { link, pages } = await this.resolve(token);
    const project = await this.db.selectFrom('projects').select(['name', 'short_name', 'cloth', 'volume_number']).where('id', '=', link.project_id).executeTakeFirstOrThrow();
    const numbers = await this.docs.numbering(link.project_id);
    const ids = new Set(pages.map((p) => p.id));
    const list = pages
      .map((p) => ({ id: p.id, parentId: p.parent_id && ids.has(p.parent_id) ? p.parent_id : null, number: numbers.get(p.id)?.number ?? '', title: p.title }))
      .sort((a, b) => compareNumbers(a.number, b.number));
    const root = link.page_id && ids.has(link.page_id) ? link.page_id : list[0]!.id;
    return {
      title: link.page_id ? (pages.find((p) => p.id === link.page_id)?.title ?? project.name) : project.name,
      kind: link.page_id ? 'page' : 'volume',
      project: { name: project.name, shortName: project.short_name, cloth: project.cloth, volumeNumber: project.volume_number },
      root,
      pages: list,
    };
  }

  /** Une page du partage: contenu sans commentaires, liens internes vers le partage ou retirés. */
  async page(token: string, pageId: string) {
    const { link, pages } = await this.resolve(token);
    if (!pages.some((p) => p.id === pageId)) throw new NotFoundException();
    const page = await this.db.selectFrom('pages').select(['id', 'title', 'summary', 'content', 'updated_at']).where('id', '=', pageId).executeTakeFirstOrThrow();
    const numbers = await this.docs.numbering(link.project_id);
    const number = numbers.get(pageId)?.number ?? '';
    const chapter = number.split('.')[0] ?? '';
    const ordered = pages.map((p) => ({ id: p.id, number: numbers.get(p.id)?.number ?? '', title: p.title })).sort((a, b) => compareNumbers(a.number, b.number));
    const index = ordered.findIndex((p) => p.id === pageId);
    const shared = new Set(pages.map((p) => p.id));
    return {
      id: page.id,
      title: page.title,
      summary: page.summary,
      number,
      updatedAt: page.updated_at.toISOString(),
      content: publicDoc(page.content as JSONContent, shared, token),
      numbering: { chapter, ...(await this.docs.offsets(link.project_id, chapter, pageId, numbers)) },
      prev: index > 0 ? ordered[index - 1]! : null,
      next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1]! : null,
    };
  }

  /** Un fichier d'une page du partage. */
  async file(token: string, fileId: string): Promise<{ name: string; contentType: string; size: number; inline: boolean; stream: Readable }> {
    const { pages } = await this.resolve(token);
    const file = await this.db.selectFrom('attachments').selectAll().where('id', '=', fileId).executeTakeFirst();
    if (!file || !pages.some((p) => p.id === file.page_id)) throw new NotFoundException();
    if (!this.storage) throw new ServiceUnavailableException("Le stockage des fichiers n'est pas configuré.");
    try {
      const stream = await this.storage.get(file.storage_key);
      return { name: file.name, contentType: file.content_type, size: file.size, inline: file.content_type.startsWith('image/'), stream };
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') throw new NotFoundException();
      throw new HttpException('Le stockage des fichiers ne répond pas.', 503);
    }
  }
}

/**
 * Le document tel qu'un inconnu le lit: sans ancres de commentaires, sans la
 * source XML des schémas, et un lien vers une autre page d'Andal ne garde son
 * adresse que si cette page fait partie du partage.
 */
export function publicDoc(node: JSONContent, shared: Set<string>, token: string): JSONContent {
  const marks = node.marks
    ?.filter((m) => m.type !== 'comment')
    .flatMap((m) => {
      if (m.type !== 'link') return [m];
      const href = String(m.attrs?.href ?? '');
      const target = pageIdFromHref(href);
      if (!target) return /^(https?:|mailto:)/i.test(href) ? [m] : [];
      return shared.has(target) ? [{ ...m, attrs: { ...m.attrs, href: `/s/${token}/${target}` } }] : [];
    });
  const attrs = node.type === 'drawio' && node.attrs ? { ...node.attrs, xml: null } : node.attrs;
  const next: JSONContent = { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map((c) => publicDoc(c, shared, token)) } : {}) };
  if (marks) {
    if (marks.length) next.marks = marks;
    else delete next.marks;
  }
  return next;
}
