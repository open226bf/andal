import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { can } from '@andal/authz';
import { ltreeLabel, pageRoleFor, projectRoleFor, recordVersion, type Database } from '@andal/db';
import { findTemplate, PAGE_TEMPLATES, templateDoc } from '@andal/editor/templates';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { DocsService } from '../docs/docs.service.js';
import { EventsService } from '../webhooks/events.service.js';
import { ContentService } from './content.service.js';
import { config } from '../env.js';
import { DB } from '../infra.module.js';

const TITLE_MAX = 120;
const SUMMARY_MAX = 400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
const DAY = 24 * 60 * 60 * 1000;

function title(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) throw new BadRequestException('Donnez un titre à la page.');
  if (text.length > TITLE_MAX) throw new BadRequestException(`Un titre fait au plus ${TITLE_MAX} caractères.`);
  return text;
}

function parentId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('Page parente invalide.');
  return value;
}

/**
 * Pages d'un volume: créer, renommer, déplacer, mettre à la corbeille et
 * restaurer. Créer demande le droit d'écriture sur la page parente (ou sur le
 * volume au premier niveau); une page ne sort jamais d'une restriction héritée
 * par un déplacement, ce qui l'ouvrirait à plus de monde sans que personne
 * l'ait décidé.
 */
@Injectable()
export class PagesService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly docs: DocsService,
    private readonly audit: AuditService,
    private readonly bridge: CollabBridgeService,
    private readonly content: ContentService,
    private readonly events: EventsService,
  ) {}

  private async project(auth: AuthContext, projectId: string) {
    const project = await this.db.selectFrom('projects').select(['id', 'workspace_id']).where('id', '=', projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    const role = project ? await projectRoleFor(this.db, auth.subject, project.id) : null;
    if (!project || !role) throw new NotFoundException();
    return { project, role };
  }

  /** Où l'on peut ajouter (ou déplacer) une page: sous une page qu'on peut écrire, ou au premier niveau si l'on écrit sur le volume. */
  private async destination(auth: AuthContext, projectId: string, parent: string | null) {
    if (parent === null) {
      const { role } = await this.project(auth, projectId);
      if (!can(role, 'page.create')) throw new ForbiddenException('Il faut le droit d’écriture sur le volume pour ajouter une page au premier niveau.');
      return null;
    }
    const access = await this.docs.require(auth.subject, parent, 'page.read');
    const row = await this.db.selectFrom('pages').select(['id', 'path', 'title', 'project_id']).where('id', '=', parent).executeTakeFirstOrThrow();
    if (access.projectId !== projectId) throw new BadRequestException('La page parente est dans un autre volume.');
    if (!can(access.role, 'page.create')) throw new ForbiddenException(`Il faut le droit d’écriture sur « ${row.title} » pour y ajouter une page.`);
    return row;
  }

  private async editable(auth: AuthContext, pageId: string) {
    const access = await this.docs.require(auth.subject, pageId, 'page.read');
    if (!can(access.role, 'page.edit')) throw new ForbiddenException('Vous ne pouvez pas modifier cette page.');
    return this.db.selectFrom('pages').select(['id', 'project_id', 'parent_id', 'path', 'title', 'position']).where('id', '=', pageId).executeTakeFirstOrThrow();
  }

  private async nextPosition(projectId: string, parent: string | null): Promise<number> {
    const row = await this.db
      .selectFrom('pages')
      .select(sql<number>`coalesce(max(position), 0)`.as('max'))
      .where('project_id', '=', projectId)
      .where((eb) => (parent === null ? eb('parent_id', 'is', null) : eb('parent_id', '=', parent)))
      .executeTakeFirstOrThrow();
    return Number(row.max) + 1;
  }

  async create(auth: AuthContext, projectId: string, input: { title?: unknown; parentId?: unknown; markdown?: unknown; content?: unknown; template?: unknown }, ip: string) {
    const name = title(input.title);
    const parent = await this.destination(auth, projectId, parentId(input.parentId));
    const template = input.template === undefined || input.template === null || input.template === '' ? null : findTemplate(String(input.template));
    if (input.template && !template) throw new BadRequestException(`Modèle inconnu. Modèles: ${PAGE_TEMPLATES.map((t) => t.id).join(', ')}.`);
    // Créée par l'API avec son contenu: personne ne l'a encore ouverte, il s'écrit directement.
    const initial =
      input.markdown !== undefined || input.content !== undefined
        ? (await this.content.prepare(projectId, { markdown: input.markdown, content: input.content })).doc
        : template
          ? templateDoc(template.id, auth.user.locale === 'en' ? 'en' : 'fr')
          : EMPTY_DOC;
    const id = randomUUID();
    await this.db
      .insertInto('pages')
      .values({
        id,
        project_id: projectId,
        parent_id: parent?.id ?? null,
        path: parent ? `${parent.path}.${ltreeLabel(id)}` : ltreeLabel(id),
        position: await this.nextPosition(projectId, parent?.id ?? null),
        title: name,
        content: JSON.stringify(initial),
        updated_by: auth.user.id,
      })
      .execute();
    // Version 1 dans l'historique: la séance qui suit la création s'y ajoute.
    await this.db.insertInto('page_versions').values({ page_id: id, version: 1, title: name, content: JSON.stringify(initial), authors: JSON.stringify([auth.user.id]) }).execute();
    if (initial !== EMPTY_DOC) await this.content.indexLater(id);
    await this.events.emit({ event: 'page.created', workspaceId: auth.user.workspace_id, projectId, actorId: auth.user.id, pageId: id });
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'page.created', targetType: 'page', targetId: id, ip, metadata: { title: name, parentId: parent?.id ?? null, ...(template ? { template: template.id } : {}) } });
    await this.bridge.treeChanged();
    return { id };
  }

  /** Titre et chapeau: une modification de la page, comme une autre. */
  async update(auth: AuthContext, pageId: string, input: { title?: unknown; summary?: unknown }, ip: string) {
    const page = await this.editable(auth, pageId);
    const changes: { title?: string; summary?: string | null } = {};
    if (input.title !== undefined) changes.title = title(input.title);
    if (input.summary !== undefined) {
      const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
      if (summary.length > SUMMARY_MAX) throw new BadRequestException(`Un chapeau fait au plus ${SUMMARY_MAX} caractères.`);
      changes.summary = summary || null;
    }
    if (Object.keys(changes).length === 0) return;
    await this.db.updateTable('pages').set({ ...changes, updated_by: auth.user.id, updated_at: new Date() }).where('id', '=', page.id).execute();
    await recordVersion(this.db, page.id, auth.user.id);
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'page.updated', targetType: 'page', targetId: page.id, ip, metadata: { from: page.title, ...changes } });
    await this.bridge.treeChanged();
  }

  /**
   * Place la page sous `parentId` (null: premier niveau), juste avant la sœur
   * `beforeId`, ou à la fin. Par une page voisine plutôt qu'un rang: les pages
   * qu'on ne voit pas (restreintes) ne décalent rien. Ses sous-pages la suivent.
   */
  async move(auth: AuthContext, pageId: string, input: { parentId?: unknown; beforeId?: unknown }, ip: string) {
    const page = await this.editable(auth, pageId);
    const target = parentId(input.parentId);
    const beforeId = typeof input.beforeId === 'string' && UUID.test(input.beforeId) ? input.beforeId : null;
    if (target === page.id) throw new BadRequestException('Une page ne peut pas aller sous elle-même.');
    const parent = await this.destination(auth, page.project_id, target);
    if (parent && (parent.path === page.path || parent.path.startsWith(`${page.path}.`))) throw new BadRequestException('Une page ne peut pas aller sous une de ses sous-pages.');

    const reparented = (parent?.id ?? null) !== page.parent_id;
    if (reparented) await this.keepRestrictions(page, parent);

    await this.db.transaction().execute(async (trx) => {
      if (reparented) {
        const newPath = parent ? `${parent.path}.${ltreeLabel(page.id)}` : ltreeLabel(page.id);
        // Les sous-pages suivent, corbeille comprise: une restauration retrouve sa place.
        await trx
          .updateTable('pages')
          .set({ path: sql`${newPath}::ltree || subpath(path, nlevel(${page.path}::ltree))` })
          .where(sql<boolean>`path <@ ${page.path}::ltree`)
          .where('id', '!=', page.id)
          .execute();
        await trx.updateTable('pages').set({ parent_id: parent?.id ?? null, path: newPath }).where('id', '=', page.id).execute();
      }
      const siblings = await trx
        .selectFrom('pages')
        .select('id')
        .where('project_id', '=', page.project_id)
        .where((eb) => (parent ? eb('parent_id', '=', parent.id) : eb('parent_id', 'is', null)))
        .where('deleted_at', 'is', null)
        .where('id', '!=', page.id)
        .orderBy('position')
        .orderBy('created_at')
        .execute();
      const order = siblings.map((s) => s.id);
      const at = beforeId ? order.indexOf(beforeId) : -1;
      order.splice(at === -1 ? order.length : at, 0, page.id);
      for (const [i, id] of order.entries()) await trx.updateTable('pages').set({ position: i + 1 }).where('id', '=', id).execute();
    });

    await this.audit.record({
      workspaceId: auth.user.workspace_id,
      actorId: auth.user.id,
      action: 'page.moved',
      targetType: 'page',
      targetId: page.id,
      ip,
      metadata: { fromParent: page.parent_id, toParent: parent?.id ?? null, beforeId },
    });
    // Changer de parente change les restrictions héritées: les connexions ouvertes sont revérifiées.
    if (reparented) await this.bridge.accessChanged();
    else await this.bridge.treeChanged();
  }

  /** Refuse un déplacement qui ferait sortir la page d'une restriction de ses parentes actuelles. */
  private async keepRestrictions(page: { path: string }, parent: { path: string } | null) {
    const inherited = (path: string | null) =>
      path === null
        ? Promise.resolve([] as { page_id: string; kind: 'view' | 'edit'; title: string }[])
        : this.db
            .selectFrom('page_restrictions as r')
            .innerJoin('pages as p', 'p.id', 'r.page_id')
            .select(['r.page_id', 'r.kind', 'p.title'])
            .where(sql<boolean>`p.path @> ${path}::ltree`)
            .distinct()
            .execute();
    const currentParent = page.path.includes('.') ? page.path.slice(0, page.path.lastIndexOf('.')) : null;
    const [before, after] = await Promise.all([inherited(currentParent), inherited(parent?.path ?? null)]);
    const escaped = before.find((b) => !after.some((a) => a.page_id === b.page_id && a.kind === b.kind));
    if (escaped) {
      throw new ConflictException(
        `Cette page hérite de la restriction en ${escaped.kind === 'view' ? 'lecture' : 'écriture'} de « ${escaped.title} ». Hors de cette page, elle s’ouvrirait à plus de monde : levez d’abord la restriction, ou choisissez une destination sous « ${escaped.title} ».`,
      );
    }
  }

  /** Met la page et ses sous-pages à la corbeille. Il faut pouvoir modifier chacune. */
  async remove(auth: AuthContext, pageId: string, ip: string) {
    const page = await this.editable(auth, pageId);
    const branch = await this.db.selectFrom('pages').select('id').where(sql<boolean>`path <@ ${page.path}::ltree`).where('deleted_at', 'is', null).execute();
    for (const { id } of branch) {
      const access = await pageRoleFor(this.db, auth.subject, id);
      if (!can(access?.role ?? null, 'page.edit')) throw new ForbiddenException('Vous ne pouvez pas modifier toutes ses sous-pages : impossible de mettre cette branche à la corbeille.');
    }
    const now = new Date();
    await this.db.updateTable('pages').set({ deleted_at: now, deleted_by: auth.user.id }).where('id', 'in', branch.map((b) => b.id)).execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'page.deleted', targetType: 'page', targetId: page.id, ip, metadata: { title: page.title, pages: branch.length } });
    await this.events.emit({ event: 'page.deleted', workspaceId: auth.user.workspace_id, projectId: page.project_id, actorId: auth.user.id, pageId: page.id });
    // Les connexions ouvertes sur ces pages sont fermées, et les navigateurs relisent leur page.
    await this.bridge.accessChanged();
    return { pages: branch.length, parentId: page.parent_id };
  }

  /** Branches à la corbeille d'un volume, pour qui peut y écrire. Chaque branche se restaure d'un bloc. */
  async trash(auth: AuthContext, projectId: string) {
    const { role } = await this.project(auth, projectId);
    if (!can(role, 'page.create')) throw new ForbiddenException('La corbeille est réservée aux personnes qui écrivent sur le volume.');
    const rows = await this.db
      .selectFrom('pages as p')
      .leftJoin('pages as parent', 'parent.id', 'p.parent_id')
      .leftJoin('users as u', 'u.id', 'p.deleted_by')
      .select(['p.id', 'p.title', 'p.path', 'p.deleted_at', 'u.name as deleted_by', 'parent.title as parent_title', 'parent.deleted_at as parent_deleted_at'])
      .where('p.project_id', '=', projectId)
      .where('p.deleted_at', 'is not', null)
      .orderBy('p.deleted_at', 'desc')
      .execute();
    const roots = rows.filter((r) => !r.parent_deleted_at || r.parent_deleted_at.getTime() !== r.deleted_at!.getTime());
    const visible = [];
    for (const root of roots) {
      // Une page restreinte reste invisible à la corbeille pour qui ne pouvait pas la lire.
      const access = await pageRoleFor(this.db, auth.subject, root.id, { includeDeleted: true });
      if (!can(access?.role ?? null, 'page.read')) continue;
      visible.push({
        id: root.id,
        title: root.title,
        deletedAt: root.deleted_at!.toISOString(),
        purgeAt: new Date(root.deleted_at!.getTime() + config.trashRetentionDays * DAY).toISOString(),
        canPurge: can(access?.role ?? null, 'project.manage'),
        deletedBy: root.deleted_by,
        subpages: rows.filter((r) => r.id !== root.id && r.path.startsWith(`${root.path}.`) && r.deleted_at!.getTime() === root.deleted_at!.getTime()).length,
        parent: root.parent_title ? { title: root.parent_title, deleted: root.parent_deleted_at !== null } : null,
      });
    }
    return visible;
  }

  /**
   * Supprime définitivement une branche de la corbeille: pages, sous-pages,
   * commentaires et historique. Réservé aux admins du volume; sans retour.
   */
  async purge(auth: AuthContext, pageId: string, ip: string) {
    const page = await this.db.selectFrom('pages').select(['id', 'title', 'deleted_at']).where('id', '=', pageId).executeTakeFirst();
    const access = page ? await pageRoleFor(this.db, auth.subject, page.id, { includeDeleted: true }) : null;
    if (!page || !page.deleted_at || !can(access?.role ?? null, 'page.read')) throw new NotFoundException();
    if (!can(access?.role ?? null, 'project.manage')) throw new ForbiddenException('Seul un admin du volume peut supprimer définitivement.');
    // Les sous-pages suivent par la clé étrangère (on delete cascade), comme commentaires, versions et notifications.
    await this.db.deleteFrom('pages').where('id', '=', page.id).execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'page.purged', targetType: 'page', targetId: page.id, ip, metadata: { title: page.title } });
  }

  /** Restaure une branche, à la fin de sa section d'origine. Sa page parente doit être là. */
  async restore(auth: AuthContext, pageId: string, ip: string) {
    const page = await this.db.selectFrom('pages').select(['id', 'project_id', 'parent_id', 'path', 'title', 'deleted_at']).where('id', '=', pageId).executeTakeFirst();
    const access = page ? await pageRoleFor(this.db, auth.subject, page.id, { includeDeleted: true }) : null;
    if (!page || !page.deleted_at || !can(access?.role ?? null, 'page.read')) throw new NotFoundException();
    if (page.parent_id) {
      const parent = await this.db.selectFrom('pages').select(['title', 'deleted_at']).where('id', '=', page.parent_id).executeTakeFirstOrThrow();
      if (parent.deleted_at) throw new ConflictException(`Restaurez d’abord « ${parent.title} », sa page parente.`);
    }
    await this.destination(auth, page.project_id, page.parent_id);
    const position = await this.nextPosition(page.project_id, page.parent_id);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('pages')
        .set({ deleted_at: null, deleted_by: null })
        .where(sql<boolean>`path <@ ${page.path}::ltree`)
        .where('deleted_at', '=', page.deleted_at)
        .execute();
      await trx.updateTable('pages').set({ position }).where('id', '=', page.id).execute();
    });
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'page.restored', targetType: 'page', targetId: page.id, ip, metadata: { title: page.title } });
    await this.bridge.accessChanged();
  }
}
