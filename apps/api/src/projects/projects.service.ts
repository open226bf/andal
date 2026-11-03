import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { can, canCreateProject, canDeleteProject, projectRole } from '@andal/authz';
import { projectGrants, type Cloth, type Database, tr } from '@andal/db';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { PagesService } from '../pages/pages.service.js';
import { RayonsService } from '../rayons/rayons.service.js';
import { DB } from '../infra.module.js';

export const CLOTHS: readonly Cloth[] = ['paiements', 'identite', 'donnees', 'mobile', 'plateforme', 'design'];
const NAME_MAX = 80;
const SHORT_MAX = 24;
const DESCRIPTION_MAX = 280;

function oneLine(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function volumeName(value: unknown): string {
  const name = oneLine(value);
  if (!name) throw new BadRequestException('Donnez un nom au volume.');
  if (name.length > NAME_MAX) throw new BadRequestException(`Un nom de volume fait au plus ${NAME_MAX} caractères.`);
  return name;
}

/** Le nom court s'écrit sur le dos du volume, dans l'étagère: il doit tenir. */
function shortName(value: unknown, name: string): string {
  const short = oneLine(value) || name;
  if (short.length > SHORT_MAX) throw new BadRequestException(`Le nom court, écrit sur le dos du volume, fait au plus ${SHORT_MAX} caractères.`);
  return short;
}

function description(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > DESCRIPTION_MAX) throw new BadRequestException(`Une description fait au plus ${DESCRIPTION_MAX} caractères.`);
  return text || null;
}

function cloth(value: unknown): Cloth {
  if (typeof value !== 'string' || !CLOTHS.includes(value as Cloth)) throw new BadRequestException('Couleur de volume inconnue.');
  return value as Cloth;
}

/** « Données & BI » → « donnees-bi »: l'adresse du volume, sans accents. */
function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'volume';
}

/**
 * Volumes de l'espace: les membres en créent (ils en deviennent admins), les
 * admins du volume le modifient, l'archivent ou le désarchivent, et seuls les
 * admins de l'espace suppriment, et seulement un volume déjà archivé.
 * Archiver retire le volume de l'étagère et de la recherche et le fige en
 * lecture: les pages ouvertes passent en lecture seule sur-le-champ.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly pages: PagesService,
    private readonly rayons: RayonsService,
    private readonly audit: AuditService,
    private readonly bridge: CollabBridgeService,
  ) {}

  /** Le volume et le rôle d'origine du sujet, archivage ignoré: c'est lui qui décide de la gestion. */
  private async managed(auth: AuthContext, projectId: string) {
    const project = await this.db.selectFrom('projects').selectAll().where('id', '=', projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    const role = project ? projectRole(auth.subject, await projectGrants(this.db, project.id)) : null;
    if (!project || !role) throw new NotFoundException();
    if (!can(role, 'project.manage')) throw new ForbiddenException('Réservé aux admins du volume.');
    return project;
  }

  /** La couleur la moins portée par les volumes en service, pour que l'étagère reste lisible. */
  private async freeCloth(workspaceId: string): Promise<Cloth> {
    const used = await this.db.selectFrom('projects').select('cloth').where('workspace_id', '=', workspaceId).where('archived_at', 'is', null).execute();
    const count = (c: Cloth) => used.filter((p) => p.cloth === c).length;
    return [...CLOTHS].sort((a, b) => count(a) - count(b))[0]!;
  }

  async create(auth: AuthContext, input: { name?: unknown; shortName?: unknown; description?: unknown; cloth?: unknown; rayonId?: unknown }, ip: string) {
    if (!canCreateProject(auth.subject)) throw new ForbiddenException('Les invités ne créent pas de volume.');
    const name = volumeName(input.name);
    const short = shortName(input.shortName, name);
    const text = description(input.description);
    const color = input.cloth === undefined ? await this.freeCloth(auth.user.workspace_id) : cloth(input.cloth);
    const rayon = input.rayonId === undefined ? null : await this.rayons.resolve(auth.user.workspace_id, input.rayonId);
    const id = randomUUID();
    const workspaceId = auth.user.workspace_id;

    const slug = await this.db.transaction().execute(async (trx) => {
      // Un volume à la fois par espace: numéro et adresse se décident sans course.
      await sql`select pg_advisory_xact_lock(hashtext(${`projects:${workspaceId}`}))`.execute(trx);
      const base = slugify(name);
      const taken = new Set((await trx.selectFrom('projects').select('slug').where('workspace_id', '=', workspaceId).where('slug', 'like', `${base}%`).execute()).map((p) => p.slug));
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      const last = await trx.selectFrom('projects').select(sql<number>`coalesce(max(volume_number), 0)`.as('max')).where('workspace_id', '=', workspaceId).executeTakeFirstOrThrow();
      await trx
        .insertInto('projects')
        .values({ id, workspace_id: workspaceId, slug, name, short_name: short, description: text, cloth: color, volume_number: Number(last.max) + 1, rayon_id: rayon })
        .execute();
      // Qui crée le volume l'administre (il pourra ensuite l'ouvrir à d'autres) et le trouve sur son étagère.
      await trx.insertInto('project_members').values({ project_id: id, principal_type: 'user', principal_id: auth.user.id, role: 'admin' }).execute();
      await trx.insertInto('project_pins').values({ user_id: auth.user.id, project_id: id }).execute();
      return slug;
    });

    await this.audit.record({ workspaceId, actorId: auth.user.id, action: 'project.created', targetType: 'project', targetId: id, ip, metadata: { name, slug } });
    // Un volume s'ouvre sur une page: la première, prête à écrire.
    const first = await this.pages.create(auth, id, { title: tr(auth.user.locale, 'Présentation') }, ip);
    return { id, slug, firstPageId: first.id };
  }

  async update(auth: AuthContext, projectId: string, input: { name?: unknown; shortName?: unknown; description?: unknown; cloth?: unknown; rayonId?: unknown }, ip: string) {
    const project = await this.managed(auth, projectId);
    if (project.archived_at) throw new ConflictException('Désarchivez le volume pour le modifier.');
    const changes: { name?: string; short_name?: string; description?: string | null; cloth?: Cloth; rayon_id?: string | null } = {};
    if (input.name !== undefined) changes.name = volumeName(input.name);
    if (input.shortName !== undefined) changes.short_name = shortName(input.shortName, changes.name ?? project.name);
    if (input.description !== undefined) changes.description = description(input.description);
    if (input.cloth !== undefined) changes.cloth = cloth(input.cloth);
    if (input.rayonId !== undefined) changes.rayon_id = await this.rayons.resolve(project.workspace_id, input.rayonId);
    if (Object.keys(changes).length === 0) return;
    await this.db.updateTable('projects').set(changes).where('id', '=', project.id).execute();
    await this.audit.record({ workspaceId: project.workspace_id, actorId: auth.user.id, action: 'project.updated', targetType: 'project', targetId: project.id, ip, metadata: { from: { name: project.name, shortName: project.short_name, cloth: project.cloth }, ...changes } });
    await this.bridge.treeChanged();
  }

  async archive(auth: AuthContext, projectId: string, ip: string) {
    const project = await this.managed(auth, projectId);
    if (project.archived_at) throw new ConflictException('Ce volume est déjà archivé.');
    await this.db.updateTable('projects').set({ archived_at: new Date(), archived_by: auth.user.id }).where('id', '=', project.id).execute();
    await this.audit.record({ workspaceId: project.workspace_id, actorId: auth.user.id, action: 'project.archived', targetType: 'project', targetId: project.id, ip, metadata: { name: project.name } });
    // Les pages ouvertes passent en lecture seule, l'étagère se relit.
    await this.bridge.accessChanged();
  }

  async unarchive(auth: AuthContext, projectId: string, ip: string) {
    const project = await this.managed(auth, projectId);
    if (!project.archived_at) throw new ConflictException('Ce volume n’est pas archivé.');
    await this.db.updateTable('projects').set({ archived_at: null, archived_by: null }).where('id', '=', project.id).execute();
    await this.audit.record({ workspaceId: project.workspace_id, actorId: auth.user.id, action: 'project.unarchived', targetType: 'project', targetId: project.id, ip, metadata: { name: project.name } });
    await this.bridge.accessChanged();
  }

  /** Sans retour: pages, commentaires, historique et droits partent avec le volume. Il faut retaper son nom court. */
  async remove(auth: AuthContext, projectId: string, input: { confirm?: unknown }, ip: string) {
    const project = await this.db.selectFrom('projects').selectAll().where('id', '=', projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    if (!project) throw new NotFoundException();
    if (!canDeleteProject(auth.subject)) throw new ForbiddenException('Seuls les admins de l’espace suppriment un volume.');
    if (!project.archived_at) throw new ConflictException('Archivez d’abord le volume: on ne supprime qu’un volume archivé.');
    if (oneLine(input.confirm) !== project.short_name) throw new BadRequestException(`Tapez « ${project.short_name} » pour confirmer.`);
    const pages = await this.db.selectFrom('pages').select(sql<number>`count(*)`.as('count')).where('project_id', '=', project.id).executeTakeFirstOrThrow();
    await this.db.deleteFrom('projects').where('id', '=', project.id).execute();
    await this.audit.record({ workspaceId: project.workspace_id, actorId: auth.user.id, action: 'project.deleted', targetType: 'project', targetId: project.id, ip, metadata: { name: project.name, slug: project.slug, pages: Number(pages.count) } });
    await this.bridge.accessChanged();
  }

  /** Épingler un volume le pose sur l'étagère de la personne; c'est son affaire, sans audit. */
  async pin(auth: AuthContext, projectId: string, pinned: boolean) {
    const project = await this.db.selectFrom('projects').select(['id', 'archived_at']).where('id', '=', projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    if (!project || !projectRole(auth.subject, await projectGrants(this.db, project.id))) throw new NotFoundException();
    if (!pinned) {
      await this.db.deleteFrom('project_pins').where('user_id', '=', auth.user.id).where('project_id', '=', project.id).execute();
      return;
    }
    if (project.archived_at) throw new ConflictException('Un volume archivé ne se pose pas sur l’étagère.');
    await this.db.insertInto('project_pins').values({ user_id: auth.user.id, project_id: project.id }).onConflict((oc) => oc.doNothing()).execute();
  }

  /** Les volumes archivés que le sujet administre: de quoi les rouvrir, les désarchiver ou les supprimer. */
  async archived(auth: AuthContext) {
    const projects = await this.db
      .selectFrom('projects')
      .leftJoin('users', 'users.id', 'projects.archived_by')
      .select(['projects.id', 'projects.slug', 'projects.name', 'projects.short_name', 'projects.cloth', 'projects.volume_number', 'projects.archived_at', 'users.name as archived_by_name'])
      .where('projects.workspace_id', '=', auth.user.workspace_id)
      .where('projects.archived_at', 'is not', null)
      .orderBy('projects.volume_number')
      .execute();
    const result = [];
    for (const p of projects) {
      if (!can(projectRole(auth.subject, await projectGrants(this.db, p.id)), 'project.manage')) continue;
      const pages = await this.db.selectFrom('pages').select(sql<number>`count(*)`.as('count')).where('project_id', '=', p.id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
      result.push({
        id: p.id,
        slug: p.slug,
        name: p.name,
        shortName: p.short_name,
        cloth: p.cloth,
        volumeNumber: p.volume_number,
        archivedAt: p.archived_at!.toISOString(),
        archivedBy: p.archived_by_name,
        pageCount: Number(pages.count),
        canDelete: canDeleteProject(auth.subject),
      });
    }
    return result;
  }
}
