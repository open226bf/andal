import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { archivedRole, can, canDeleteProject, matches, projectRole, type Action, type ProjectRole, type Subject } from '@andal/authz';
import { pageRoleFor, projectGrants, readablePages, type Database, type TreeRow } from '@andal/db';
import { countNumbered, type JSONContent } from '@andal/editor';
import { sql, type Kysely } from 'kysely';
import { forgeUrl } from '../git/git.service.js';
import { DB } from '../infra.module.js';

export interface PrincipalView {
  type: 'user' | 'group';
  id: string;
  name: string;
  members: number | null;
  you: boolean;
  /** Personne: avatar, et invité de l'espace (plafonné à éditeur). */
  initials: string | null;
  color: string | null;
  guest: boolean;
}

/** Une entrée de l'annuaire du panneau Partager: personne active ou groupe. */
export interface DirectoryEntry extends PrincipalView {
  /** Identifiant ou email d'une personne. */
  detail: string;
}

const ROLE_RANK: Record<ProjectRole, number> = { admin: 4, editor: 3, commenter: 2, reader: 1 };

export interface Ordered {
  id: string;
  number: string;
  depth: number;
}

/**
 * Lecture des volumes et des pages. Chaque méthode vérifie les droits avec
 * @andal/authz avant de renvoyer quoi que ce soit; une page illisible
 * répond 404, comme une page inexistante, pour ne pas révéler son existence.
 */
@Injectable()
export class DocsService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /**
   * Les volumes ouverts au sujet, pour la bibliothèque et l'étagère: épinglés
   * ou non, et la date de la dernière modification qu'il peut voir.
   */
  async listProjects(subject: Subject, workspaceId: string) {
    // Un volume archivé quitte l'étagère et la recherche; ses admins le retrouvent dans les archives.
    const [projects, pins] = await Promise.all([
      this.db.selectFrom('projects').selectAll().where('workspace_id', '=', workspaceId).where('archived_at', 'is', null).orderBy('volume_number').execute(),
      this.db.selectFrom('project_pins').select('project_id').where('user_id', '=', subject.userId).execute(),
    ]);
    const pinned = new Set(pins.map((p) => p.project_id));
    const result = [];
    for (const project of projects) {
      const role = projectRole(subject, await projectGrants(this.db, project.id));
      if (!role) continue;
      const pages = await readablePages(this.db, subject, project.id);
      const first = this.order(pages)[0];
      result.push({
        id: project.id,
        slug: project.slug,
        name: project.name,
        shortName: project.short_name,
        description: project.description,
        cloth: project.cloth,
        volumeNumber: project.volume_number,
        role,
        pageCount: pages.length,
        firstPageId: first?.id ?? null,
        pinned: pinned.has(project.id),
        rayonId: project.rayon_id,
        // La page la plus fraîche; un volume sans page lisible date de sa création.
        updatedAt: (pages.length ? pages.reduce((latest, p) => (p.updated_at > latest ? p.updated_at : latest), pages[0]!.updated_at) : project.created_at).toISOString(),
      });
    }
    return result;
  }

  async tree(subject: Subject, slug: string, workspaceId: string) {
    const project = await this.db.selectFrom('projects').selectAll().where('workspace_id', '=', workspaceId).where('slug', '=', slug).executeTakeFirst();
    if (!project) throw new NotFoundException();
    // Le rôle d'origine décide de la gestion (désarchiver); le rôle effectif, de l'écriture.
    const original = projectRole(subject, await projectGrants(this.db, project.id));
    if (!original) throw new NotFoundException();
    const archived = project.archived_at !== null;
    const role = archivedRole(original, archived)!;

    const [pages, numbers] = await Promise.all([readablePages(this.db, subject, project.id), this.numbering(project.id)]);
    const visible = new Set(pages.map((p) => p.id));
    return {
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
        shortName: project.short_name,
        description: project.description,
        cloth: project.cloth,
        volumeNumber: project.volume_number,
        rayonId: project.rayon_id,
        role,
        archived,
        canManage: can(original, 'project.manage'),
        canDelete: canDeleteProject(subject),
      },
      pages: pages
        .filter((p) => !p.parent_id || visible.has(p.parent_id))
        .map((p) => ({
          id: p.id,
          parentId: p.parent_id,
          number: numbers.get(p.id)?.number ?? '',
          title: p.title,
          role: p.role,
          restricted: p.restricted,
          git: p.git,
          updatedAt: p.updated_at.toISOString(),
        }))
        .sort((a, b) => compareNumbers(a.number, b.number)),
    };
  }

  async page(subject: Subject, pageId: string) {
    const access = await this.require(subject, pageId, 'page.read');
    const page = await this.db
      .selectFrom('pages')
      .leftJoin('users', 'users.id', 'pages.updated_by')
      .leftJoin('git_syncs', 'git_syncs.id', 'pages.git_sync_id')
      .select(['pages.id', 'pages.project_id', 'pages.parent_id', 'pages.title', 'pages.summary', 'pages.content', 'pages.version', 'pages.updated_at', 'pages.path', 'pages.git_path', 'users.name as updated_by_name'])
      .select(['git_syncs.repo_url', 'git_syncs.branch', 'git_syncs.path as git_root', 'git_syncs.last_synced_at'])
      .where('pages.id', '=', pageId)
      .executeTakeFirstOrThrow();
    const project = await this.db.selectFrom('projects').selectAll().where('id', '=', page.project_id).executeTakeFirstOrThrow();
    // Page tenue par un dépôt Git: d'où elle vient, et où la modifier.
    const git =
      page.repo_url && page.git_path !== null
        ? {
            repo: page.repo_url.replace(/^\w+:\/\//, '').replace(/\.git$/, ''),
            file: [page.git_root, page.git_path].filter(Boolean).join('/'),
            url: forgeUrl(page.repo_url, page.branch ?? 'main', page.git_root ?? '', page.git_path),
            syncedAt: page.last_synced_at?.toISOString() ?? null,
          }
        : null;

    const [readable, numbers] = await Promise.all([readablePages(this.db, subject, project.id), this.numbering(project.id)]);
    const readableIds = new Set(readable.map((p) => p.id));
    const ordered = this.order(readable);
    const index = ordered.findIndex((p) => p.id === pageId);
    const number = numbers.get(pageId)?.number ?? '';
    const chapter = number.split('.')[0] ?? '';

    const ancestors = page.path.split('.').slice(0, -1).map((label) => label.replaceAll('_', '-'));
    const titles = new Map(readable.map((p) => [p.id, p.title]));
    const breadcrumb = ancestors
      .filter((id) => readableIds.has(id))
      .map((id) => ({ id, number: numbers.get(id)?.number ?? '', title: titles.get(id) ?? '' }));

    const neighbour = (i: number) => {
      const target = ordered[i];
      return target ? { id: target.id, number: numbers.get(target.id)?.number ?? '', title: titles.get(target.id) ?? '' } : null;
    };

    return {
      id: page.id,
      title: page.title,
      summary: page.summary,
      number,
      content: page.content as JSONContent,
      version: page.version,
      updatedAt: new Date(page.updated_at).toISOString(),
      updatedBy: page.updated_by_name,
      role: access.role,
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
        shortName: project.short_name,
        cloth: project.cloth,
        volumeNumber: project.volume_number,
        pageCount: readable.length,
      },
      breadcrumb,
      numbering: { chapter, ...(await this.offsets(project.id, chapter, pageId, numbers)) },
      access: await this.accessSummary(subject, project.id, pageId),
      prev: index > 0 ? neighbour(index - 1) : null,
      next: index >= 0 ? neighbour(index + 1) : null,
      backlinks: await this.backlinks(subject, pageId),
      git,
    };
  }

  /**
   * Le panneau Partager: accès au volume (rôle exact de chaque grant),
   * restrictions de la page et de ses parentes, et l'annuaire pour ajouter
   * quelqu'un, seulement à qui peut modifier quelque chose.
   */
  async sharing(subject: Subject, pageId: string) {
    const access = await this.require(subject, pageId, 'page.read');
    const canShare = can(access.role, 'project.share');
    const canRestrict = can(access.role, 'page.restrict');
    const project = await this.db.selectFrom('projects').select(['id', 'workspace_id', 'name', 'short_name']).where('id', '=', access.projectId).executeTakeFirstOrThrow();
    const data = await this.accessData(subject, access.projectId, pageId);

    const ancestors = [...new Set(data.restrictions.filter((r) => r.page_id !== pageId).map((r) => r.page_id))];
    const [numbers, titles] = await Promise.all([
      this.numbering(access.projectId),
      ancestors.length ? this.db.selectFrom('pages').select(['id', 'title']).where('id', 'in', ancestors).execute() : [],
    ]);
    const onPage = (kind: 'view' | 'edit') => data.restrictions.filter((r) => r.page_id === pageId && r.kind === kind).map((r) => data.view(r.principal_type, r.principal_id));

    return {
      projectId: project.id,
      project: { name: project.name, shortName: project.short_name },
      role: access.role,
      canShare,
      canRestrict,
      ...this.summarize(data, pageId),
      grants: data.grants
        .map((g) => ({ principal: data.view(g.principal_type, g.principal_id), role: g.role }))
        .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.principal.name.localeCompare(b.principal.name, 'fr')),
      pageRestrictions: { view: onPage('view'), edit: onPage('edit') },
      // Lire cette page implique de lire ses parentes: leurs titres ne révèlent rien.
      inheritedRestrictions: ancestors.flatMap((id) =>
        (['view', 'edit'] as const)
          .map((kind) => ({
            page: { id, number: numbers.get(id)?.number ?? '', title: titles.find((t) => t.id === id)?.title ?? '' },
            kind,
            principals: data.restrictions.filter((r) => r.page_id === id && r.kind === kind).map((r) => data.view(r.principal_type, r.principal_id)),
          }))
          .filter((r) => r.principals.length > 0),
      ),
      directory: canShare || canRestrict ? await this.directory(subject, project.workspace_id) : null,
    };
  }

  /** Personnes actives et groupes de l'espace, pour les ajouter à un volume ou à une restriction. */
  private async directory(subject: Subject, workspaceId: string): Promise<DirectoryEntry[]> {
    const [users, groups] = await Promise.all([
      this.db
        .selectFrom('users')
        .select(['id', 'name', 'initials', 'color', 'email', 'username', 'workspace_role'])
        .where('workspace_id', '=', workspaceId)
        .where('disabled_at', 'is', null)
        .orderBy('name')
        .execute(),
      this.db
        .selectFrom('groups')
        .leftJoin('group_members', 'group_members.group_id', 'groups.id')
        .select(['groups.id', 'groups.name', (eb) => eb.fn.count<string>('group_members.user_id').as('members')])
        .where('groups.workspace_id', '=', workspaceId)
        .groupBy(['groups.id', 'groups.name'])
        .orderBy('groups.name')
        .execute(),
    ]);
    return [
      ...groups.map((g) => ({ type: 'group' as const, id: g.id, name: g.name, members: Number(g.members), you: subject.groupIds.includes(g.id), initials: null, color: null, guest: false, detail: `${g.members} personne(s)` })),
      ...users.map((u) => ({ type: 'user' as const, id: u.id, name: u.name, members: null, you: u.id === subject.userId, initials: u.initials, color: u.color, guest: u.workspace_role === 'guest', detail: u.username ?? u.email })),
    ];
  }

  async search(subject: Subject, workspaceId: string, q: string) {
    const query = q.trim().slice(0, 200);
    if (!query) return [];
    const projects = await this.listProjects(subject, workspaceId);
    const results = [];
    for (const project of projects) {
      const [readable, numbers] = await Promise.all([readablePages(this.db, subject, project.id), this.numbering(project.id)]);
      if (readable.length === 0) continue;
      const tsQuery = sql`websearch_to_tsquery('french', ${query})`;
      const hits = await this.db
        .selectFrom('pages')
        .select(['id', 'title'])
        .select(sql<string>`ts_headline('french', text_content, ${tsQuery}, 'MaxWords=18, MinWords=8, StartSel=«, StopSel=»')`.as('snippet'))
        .where('project_id', '=', project.id)
        .where('id', 'in', readable.map((p) => p.id))
        .where(sql<boolean>`search @@ ${tsQuery}`)
        .orderBy(sql`ts_rank(search, ${tsQuery})`, 'desc')
        .limit(10)
        .execute();
      for (const hit of hits) {
        results.push({ id: hit.id, title: hit.title, snippet: hit.snippet, number: numbers.get(hit.id)?.number ?? '', project: { slug: project.slug, shortName: project.shortName, cloth: project.cloth } });
      }
    }
    return results.slice(0, 20);
  }

  /**
   * Pages à lier, par leur titre ou leur numéro, dans tous les volumes lisibles
   * (archivés exclus). Le volume en cours vient en premier.
   */
  async lookup(subject: Subject, workspaceId: string, q: string, currentSlug?: string) {
    const query = fold(q.trim()).slice(0, 120);
    if (!query) return [];
    const projects = (await this.listProjects(subject, workspaceId)).sort((a, b) => Number(b.slug === currentSlug) - Number(a.slug === currentSlug));
    const results = [];
    for (const project of projects) {
      const [readable, numbers] = await Promise.all([readablePages(this.db, subject, project.id), this.numbering(project.id)]);
      for (const page of readable) {
        const number = numbers.get(page.id)?.number ?? '';
        if (!fold(page.title).includes(query) && number !== query) continue;
        results.push({ id: page.id, title: page.title, number, project: { slug: project.slug, shortName: project.shortName, cloth: project.cloth } });
      }
      if (results.length >= 12) break;
    }
    return results.slice(0, 12);
  }

  /** Aperçu d'une page au survol d'un lien: même règle que la page, 404 si elle est illisible. */
  async preview(subject: Subject, pageId: string) {
    const access = await this.require(subject, pageId, 'page.read');
    const page = await this.db.selectFrom('pages').select(['id', 'title', 'summary', 'text_content', 'updated_at']).where('id', '=', pageId).executeTakeFirstOrThrow();
    const project = await this.db.selectFrom('projects').select(['slug', 'name', 'short_name', 'cloth']).where('id', '=', access.projectId).executeTakeFirstOrThrow();
    const numbers = await this.numbering(access.projectId);
    const text = page.text_content.replace(/\s+/g, ' ').trim();
    return {
      id: page.id,
      title: page.title,
      number: numbers.get(page.id)?.number ?? '',
      summary: page.summary,
      excerpt: text.length > 220 ? `${text.slice(0, 219)}…` : text,
      updatedAt: page.updated_at.toISOString(),
      project: { slug: project.slug, name: project.name, shortName: project.short_name, cloth: project.cloth },
    };
  }

  /** Les pages qui citent celle-ci, seulement celles que le sujet peut lire. */
  private async backlinks(subject: Subject, pageId: string) {
    const sources = await this.db
      .selectFrom('page_links as l')
      .innerJoin('pages as p', 'p.id', 'l.source_id')
      .innerJoin('projects as pr', 'pr.id', 'p.project_id')
      .select(['p.id', 'p.title', 'p.project_id', 'pr.slug', 'pr.short_name', 'pr.cloth'])
      .where('l.target_id', '=', pageId)
      .where('p.deleted_at', 'is', null)
      .orderBy('p.title')
      .limit(50)
      .execute();
    const numbering = new Map<string, Map<string, Ordered>>();
    const result = [];
    for (const source of sources) {
      const access = await pageRoleFor(this.db, subject, source.id);
      if (!access?.role || !can(access.role, 'page.read')) continue;
      if (!numbering.has(source.project_id)) numbering.set(source.project_id, await this.numbering(source.project_id));
      result.push({
        id: source.id,
        title: source.title,
        number: numbering.get(source.project_id)!.get(source.id)?.number ?? '',
        project: { slug: source.slug, shortName: source.short_name, cloth: source.cloth },
      });
    }
    return result;
  }

  /** Charge le rôle et refuse en 404 si l'action n'est pas permise. */
  async require(subject: Subject, pageId: string, action: Action): Promise<{ projectId: string; role: ProjectRole }> {
    const access = await pageRoleFor(this.db, subject, pageId);
    if (access?.role && !can(access.role, action) && (action === 'page.edit' || action === 'page.create')) {
      // Lisible, mais tenue par Git: on dit pourquoi, plutôt qu'un 404.
      const page = await this.db.selectFrom('pages').select('git_sync_id').where('id', '=', pageId).executeTakeFirst();
      if (page?.git_sync_id) throw new ForbiddenException('Cette page vient d’un dépôt Git: modifiez-la dans le dépôt, la synchro suivante la mettra à jour.');
    }
    if (!access || !access.role || !can(access.role, action)) throw new NotFoundException();
    return { projectId: access.projectId, role: access.role };
  }

  /** Numéros de section de pages de volumes quelconques (sources de l'assistant). */
  async numbers(pageIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (pageIds.length === 0) return out;
    const rows = await this.db.selectFrom('pages').select(['id', 'project_id']).where('id', 'in', pageIds).execute();
    for (const projectId of new Set(rows.map((r) => r.project_id))) {
      const numbers = await this.numbering(projectId);
      for (const r of rows.filter((x) => x.project_id === projectId)) out.set(r.id, numbers.get(r.id)?.number ?? '');
    }
    return out;
  }

  /** Numéros de section (1, 3.2, 4.1…) sur TOUTES les pages, pour qu'ils ne changent pas selon le lecteur. */
  async numbering(projectId: string): Promise<Map<string, Ordered>> {
    const pages = await this.db.selectFrom('pages').select(['id', 'parent_id', 'position']).where('project_id', '=', projectId).where('deleted_at', 'is', null).orderBy('position').orderBy('created_at').execute();
    const children = new Map<string | null, typeof pages>();
    for (const p of pages) children.set(p.parent_id, [...(children.get(p.parent_id) ?? []), p]);
    const result = new Map<string, Ordered>();
    const visit = (parent: string | null, prefix: string, depth: number) => {
      (children.get(parent) ?? []).forEach((p, i) => {
        const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
        result.set(p.id, { id: p.id, number, depth });
        visit(p.id, number, depth + 1);
      });
    };
    visit(null, '', 0);
    return result;
  }

  private order(pages: TreeRow[]): { id: string; number: string }[] {
    const children = new Map<string | null, TreeRow[]>();
    const ids = new Set(pages.map((p) => p.id));
    for (const p of pages) {
      const parent = p.parent_id && ids.has(p.parent_id) ? p.parent_id : null;
      children.set(parent, [...(children.get(parent) ?? []), p]);
    }
    const out: { id: string; number: string }[] = [];
    const visit = (parent: string | null) => {
      for (const p of (children.get(parent) ?? []).sort((a, b) => a.position - b.position)) {
        out.push({ id: p.id, number: '' });
        visit(p.id);
      }
    };
    visit(null);
    return out;
  }

  /** Figures et listings déjà numérotés dans les pages précédentes du même chapitre. */
  async offsets(projectId: string, chapter: string, pageId: string, numbers: Map<string, Ordered>) {
    const before = [...numbers.values()]
      .filter((n) => n.number.split('.')[0] === chapter && compareNumbers(n.number, numbers.get(pageId)?.number ?? '') < 0)
      .map((n) => n.id);
    let figureOffset = 0;
    let listingOffset = 0;
    if (before.length > 0) {
      const rows = await this.db.selectFrom('pages').select('content').where('project_id', '=', projectId).where('id', 'in', before).execute();
      for (const row of rows) {
        const counted = countNumbered(row.content as JSONContent);
        figureOffset += counted.figures;
        listingOffset += counted.listings;
      }
    }
    return { figureOffset, listingOffset };
  }

  /** Qui peut écrire, commenter ou lire: les grants du volume et les restrictions de la page. */
  private async accessSummary(subject: Subject, projectId: string, pageId: string) {
    return this.summarize(await this.accessData(subject, projectId, pageId), pageId);
  }

  /** Grants du volume et restrictions de la page et de ses parentes, avec de quoi les afficher. */
  private async accessData(subject: Subject, projectId: string, pageId: string) {
    const grants = await this.db.selectFrom('project_members').selectAll().where('project_id', '=', projectId).execute();
    const restrictions = await this.db
      .selectFrom('page_restrictions as r')
      .innerJoin('pages as p', 'p.id', 'r.page_id')
      .select(['r.page_id', 'r.kind', 'r.principal_type', 'r.principal_id'])
      .where(({ eb, ref, selectFrom }) => eb(ref('p.path'), '@>', selectFrom('pages').select('path').where('id', '=', pageId)))
      .execute();

    const principals = [...grants, ...restrictions].map((r) => ({ type: r.principal_type, id: r.principal_id }));
    const views = await this.describe(subject, principals);
    // Un principal effacé entre-temps (groupe supprimé) reste affichable.
    const view = (type: 'user' | 'group', id: string): PrincipalView =>
      views.get(`${type}:${id}`) ?? { type, id, name: type === 'group' ? 'Groupe supprimé' : 'Compte supprimé', members: null, you: false, initials: null, color: null, guest: false };
    return { grants, restrictions, view };
  }

  private summarize(data: Awaited<ReturnType<DocsService['accessData']>>, pageId: string) {
    const level = { write: [] as PrincipalView[], comment: [] as PrincipalView[], read: [] as PrincipalView[] };
    for (const g of data.grants) {
      const bucket = g.role === 'editor' || g.role === 'admin' ? level.write : g.role === 'commenter' ? level.comment : level.read;
      bucket.push(data.view(g.principal_type, g.principal_id));
    }
    return {
      ...level,
      inherited: data.restrictions.every((r) => r.page_id !== pageId),
      restrictions: data.restrictions.map((r) => ({ pageId: r.page_id, kind: r.kind, onThisPage: r.page_id === pageId, principal: data.view(r.principal_type, r.principal_id) })),
    };
  }

  private async describe(subject: Subject, refs: { type: 'user' | 'group'; id: string }[]): Promise<Map<string, PrincipalView>> {
    const userIds = refs.filter((r) => r.type === 'user').map((r) => r.id);
    const groupIds = refs.filter((r) => r.type === 'group').map((r) => r.id);
    const [users, groups] = await Promise.all([
      userIds.length ? this.db.selectFrom('users').select(['id', 'name', 'initials', 'color', 'workspace_role']).where('id', 'in', userIds).execute() : [],
      groupIds.length
        ? this.db
            .selectFrom('groups')
            .leftJoin('group_members', 'group_members.group_id', 'groups.id')
            .select(['groups.id', 'groups.name', (eb) => eb.fn.count<string>('group_members.user_id').as('members')])
            .where('groups.id', 'in', groupIds)
            .groupBy(['groups.id', 'groups.name'])
            .execute()
        : [],
    ]);
    const map = new Map<string, PrincipalView>();
    for (const u of users) {
      map.set(`user:${u.id}`, { type: 'user', id: u.id, name: u.name, members: null, you: matches(subject, { type: 'user', id: u.id }), initials: u.initials, color: u.color, guest: u.workspace_role === 'guest' });
    }
    for (const g of groups) {
      map.set(`group:${g.id}`, { type: 'group', id: g.id, name: g.name, members: Number(g.members), you: matches(subject, { type: 'group', id: g.id }), initials: null, color: null, guest: false });
    }
    return map;
  }
}

/** Sans accents ni casse: « cle » trouve « Clé ». */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function compareNumbers(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
