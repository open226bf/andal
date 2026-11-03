import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { canManageAccounts } from '@andal/authz';
import type { Database, User } from '@andal/db';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { DB } from '../infra.module.js';

const NAME_MAX = 60;

function groupName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new BadRequestException('Donnez un nom au groupe.');
  if (name.length > NAME_MAX) throw new BadRequestException(`Un nom de groupe fait au plus ${NAME_MAX} caractères.`);
  return name;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/**
 * Groupes de l'espace, gérés par ses propriétaires et admins. Un groupe ouvre
 * des volumes (grants) et sert de liste dans les restrictions de pages: tout
 * changement de membres change des droits, donc le serveur collab revérifie.
 */
@Injectable()
export class GroupsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bridge: CollabBridgeService,
  ) {}

  private assertAdmin(actor: User) {
    if (!canManageAccounts(actor.workspace_role)) throw new ForbiddenException("Réservé aux admins de l'espace.");
  }

  private async group(actor: User, groupId: string) {
    const group = await this.db.selectFrom('groups').selectAll().where('id', '=', groupId).where('workspace_id', '=', actor.workspace_id).executeTakeFirst();
    if (!group) throw new NotFoundException('Groupe introuvable.');
    return group;
  }

  async overview(actor: User) {
    this.assertAdmin(actor);
    const workspaceId = actor.workspace_id;
    const [groups, members, grants, restrictions, users] = await Promise.all([
      this.db.selectFrom('groups').select(['id', 'name']).where('workspace_id', '=', workspaceId).orderBy(sql`lower(name)`).execute(),
      this.db
        .selectFrom('group_members as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .innerJoin('groups as g', 'g.id', 'm.group_id')
        .select(['m.group_id', 'u.id', 'u.name', 'u.initials', 'u.color', 'u.email', 'u.disabled_at'])
        .where('g.workspace_id', '=', workspaceId)
        .orderBy('u.name')
        .execute(),
      this.db
        .selectFrom('project_members as pm')
        .innerJoin('projects as p', 'p.id', 'pm.project_id')
        .select(['pm.principal_id', 'pm.role', 'p.id', 'p.short_name', 'p.cloth', 'p.volume_number'])
        .where('pm.principal_type', '=', 'group')
        .where('p.workspace_id', '=', workspaceId)
        .orderBy('p.volume_number')
        .execute(),
      this.db
        .selectFrom('page_restrictions as r')
        .innerJoin('pages as pg', 'pg.id', 'r.page_id')
        .innerJoin('projects as p', 'p.id', 'pg.project_id')
        .select(['r.principal_id', 'r.page_id'])
        .where('r.principal_type', '=', 'group')
        .where('p.workspace_id', '=', workspaceId)
        .execute(),
      this.db.selectFrom('users').select(['id', 'name', 'initials', 'color', 'email']).where('workspace_id', '=', workspaceId).where('disabled_at', 'is', null).orderBy('name').execute(),
    ]);
    return {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        members: members.filter((m) => m.group_id === g.id).map((m) => ({ id: m.id, name: m.name, initials: m.initials, color: m.color, email: m.email, disabled: m.disabled_at !== null })),
        volumes: grants.filter((x) => x.principal_id === g.id).map((x) => ({ id: x.id, shortName: x.short_name, cloth: x.cloth, volumeNumber: x.volume_number, role: x.role })),
        restrictedPages: new Set(restrictions.filter((r) => r.principal_id === g.id).map((r) => r.page_id)).size,
      })),
      users,
    };
  }

  async create(actor: User, input: { name?: unknown }, ip: string) {
    this.assertAdmin(actor);
    const name = groupName(input.name);
    try {
      const created = await this.db.insertInto('groups').values({ workspace_id: actor.workspace_id, name }).returning('id').executeTakeFirstOrThrow();
      await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'group.created', targetType: 'group', targetId: created.id, ip, metadata: { name } });
      return { id: created.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Un groupe porte déjà ce nom.');
      throw error;
    }
  }

  async rename(actor: User, groupId: string, input: { name?: unknown }, ip: string) {
    this.assertAdmin(actor);
    const group = await this.group(actor, groupId);
    const name = groupName(input.name);
    if (name === group.name) return;
    try {
      await this.db.updateTable('groups').set({ name }).where('id', '=', group.id).execute();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Un groupe porte déjà ce nom.');
      throw error;
    }
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'group.renamed', targetType: 'group', targetId: group.id, ip, metadata: { from: group.name, to: name } });
  }

  /**
   * Supprimer un groupe retire ses accès aux volumes. Refusé tant qu'il figure
   * dans une restriction: sans lui, la liste pourrait se vider et la page
   * s'ouvrir à tout le volume.
   */
  async remove(actor: User, groupId: string, ip: string) {
    this.assertAdmin(actor);
    const group = await this.group(actor, groupId);
    const used = await this.db.selectFrom('page_restrictions').select(sql<string>`count(distinct page_id)`.as('n')).where('principal_type', '=', 'group').where('principal_id', '=', group.id).executeTakeFirstOrThrow();
    const pages = Number(used.n);
    if (pages > 0) {
      throw new ConflictException(`Ce groupe restreint l’accès à ${pages} page${pages > 1 ? 's' : ''}. Retirez-le d’abord de ces restrictions: le supprimer pourrait les ouvrir à tout le volume.`);
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('project_members').where('principal_type', '=', 'group').where('principal_id', '=', group.id).execute();
      await trx.deleteFrom('groups').where('id', '=', group.id).execute();
    });
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'group.deleted', targetType: 'group', targetId: group.id, ip, metadata: { name: group.name } });
    await this.bridge.accessChanged();
  }

  async addMember(actor: User, groupId: string, userId: string, ip: string) {
    this.assertAdmin(actor);
    const group = await this.group(actor, groupId);
    const user = await this.db.selectFrom('users').select(['id', 'disabled_at', 'name']).where('id', '=', userId).where('workspace_id', '=', actor.workspace_id).executeTakeFirst();
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.disabled_at) throw new BadRequestException(`Le compte de ${user.name} est désactivé.`);
    const added = await this.db.insertInto('group_members').values({ group_id: group.id, user_id: user.id }).onConflict((oc) => oc.doNothing()).returning('user_id').executeTakeFirst();
    if (!added) return;
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'group.member_added', targetType: 'group', targetId: group.id, ip, metadata: { userId: user.id } });
    await this.bridge.accessChanged();
  }

  async removeMember(actor: User, groupId: string, userId: string, ip: string) {
    this.assertAdmin(actor);
    const group = await this.group(actor, groupId);
    const removed = await this.db.deleteFrom('group_members').where('group_id', '=', group.id).where('user_id', '=', userId).returning('user_id').executeTakeFirst();
    if (!removed) return;
    await this.audit.record({ workspaceId: actor.workspace_id, actorId: actor.id, action: 'group.member_removed', targetType: 'group', targetId: group.id, ip, metadata: { userId } });
    await this.bridge.accessChanged();
  }
}
