import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { canArrangeLibrary } from '@andal/authz';
import type { Database, User } from '@andal/db';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { DB } from '../infra.module.js';

const NAME_MAX = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function rayonName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new BadRequestException('Donnez un nom au rayon.');
  if (name.length > NAME_MAX) throw new BadRequestException(`Un nom de rayon fait au plus ${NAME_MAX} caractères.`);
  return name;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/**
 * Les rayons de la bibliothèque: un seul niveau, ordonné, qui range les
 * volumes par domaine. Tout le monde les voit; les admins de l'espace les
 * créent, les renomment, les ordonnent et les suppriment. Un rayon supprimé
 * laisse ses volumes hors rayon, sans rien perdre d'autre.
 */
@Injectable()
export class RayonsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  private assertAdmin(actor: User) {
    if (!canArrangeLibrary(actor.workspace_role)) throw new ForbiddenException('Seuls les admins de l’espace rangent la bibliothèque.');
  }

  private async rayon(actor: User, rayonId: string) {
    const rayon = await this.db.selectFrom('rayons').selectAll().where('id', '=', rayonId).where('workspace_id', '=', actor.workspace_id).executeTakeFirst();
    if (!rayon) throw new NotFoundException('Rayon introuvable.');
    return rayon;
  }

  async list(actor: User) {
    const rows = await this.db.selectFrom('rayons').select(['id', 'name', 'position']).where('workspace_id', '=', actor.workspace_id).orderBy('position').orderBy(sql`lower(name)`).execute();
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async create(actor: User, input: { name?: unknown }, ip: string) {
    this.assertAdmin(actor);
    const name = rayonName(input.name);
    const last = await this.db.selectFrom('rayons').select(sql<number>`coalesce(max(position), 0)`.as('max')).where('workspace_id', '=', actor.workspace_id).executeTakeFirstOrThrow();
    try {
      const created = await this.db.insertInto('rayons').values({ workspace_id: actor.workspace_id, name, position: Number(last.max) + 1 }).returning('id').executeTakeFirstOrThrow();
      await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'rayon.created', targetType: 'rayon', targetId: created.id, ip, metadata: { name } });
      return { id: created.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Un rayon porte déjà ce nom.');
      throw error;
    }
  }

  async rename(actor: User, rayonId: string, input: { name?: unknown }, ip: string) {
    this.assertAdmin(actor);
    const rayon = await this.rayon(actor, rayonId);
    const name = rayonName(input.name);
    if (name === rayon.name) return;
    try {
      await this.db.updateTable('rayons').set({ name }).where('id', '=', rayon.id).execute();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Un rayon porte déjà ce nom.');
      throw error;
    }
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'rayon.renamed', targetType: 'rayon', targetId: rayon.id, ip, metadata: { from: rayon.name, to: name } });
  }

  async remove(actor: User, rayonId: string, ip: string) {
    this.assertAdmin(actor);
    const rayon = await this.rayon(actor, rayonId);
    const volumes = await this.db.selectFrom('projects').select(sql<number>`count(*)`.as('count')).where('rayon_id', '=', rayon.id).executeTakeFirstOrThrow();
    // Ses volumes passent hors rayon (on delete set null).
    await this.db.deleteFrom('rayons').where('id', '=', rayon.id).execute();
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'rayon.deleted', targetType: 'rayon', targetId: rayon.id, ip, metadata: { name: rayon.name, volumes: Number(volumes.count) } });
  }

  /** Le nouvel ordre: tous les rayons de l'espace, chacun une fois. */
  async reorder(actor: User, input: { ids?: unknown }, ip: string) {
    this.assertAdmin(actor);
    const current = await this.db.selectFrom('rayons').select('id').where('workspace_id', '=', actor.workspace_id).execute();
    const ids = Array.isArray(input.ids) ? input.ids : null;
    const known = new Set(current.map((r) => r.id));
    if (!ids || ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => typeof id === 'string' && known.has(id))) {
      throw new BadRequestException('Donnez tous les rayons de l’espace, chacun une fois.');
    }
    await this.db.transaction().execute(async (trx) => {
      for (const [index, id] of (ids as string[]).entries()) await trx.updateTable('rayons').set({ position: index + 1 }).where('id', '=', id).execute();
    });
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'rayon.reordered', targetType: 'workspace', targetId: actor.workspace_id, ip, metadata: { ids } });
  }

  /** Pour les volumes: un rayon de l'espace, ou null pour hors rayon. */
  async resolve(workspaceId: string, value: unknown): Promise<string | null> {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('Rayon invalide.');
    const rayon = await this.db.selectFrom('rayons').select('id').where('id', '=', value).where('workspace_id', '=', workspaceId).executeTakeFirst();
    if (!rayon) throw new BadRequestException('Ce rayon n’existe pas.');
    return rayon.id;
  }
}
