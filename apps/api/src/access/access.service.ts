import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { can, pageRole, PROJECT_ROLES, projectRole, type Grant, type PrincipalRef, type ProjectRole, type Restriction, type RestrictionKind } from '@andal/authz';
import { projectGrants, type Database } from '@andal/db';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { DocsService } from '../docs/docs.service.js';
import { DB } from '../infra.module.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PRINCIPALS = 50;

const same = (a: PrincipalRef, b: PrincipalRef) => a.type === b.type && a.id === b.id;

/**
 * Modifier les accès: grants d'un volume (admins du volume) et restrictions
 * d'une page (droit d'écriture sur la page). Les décisions viennent de
 * @andal/authz; chaque changement est audité, et le serveur collab
 * revérifie aussitôt les connexions ouvertes.
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly docs: DocsService,
    private readonly audit: AuditService,
    private readonly bridge: CollabBridgeService,
  ) {}

  /** Le volume, si l'acteur l'administre. Invisible (404) s'il n'y a aucun accès. */
  private async sharedProject(auth: AuthContext, projectId: string) {
    const project = await this.db.selectFrom('projects').select(['id', 'workspace_id', 'slug', 'archived_at']).where('id', '=', projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    if (!project) throw new NotFoundException();
    const grants = await projectGrants(this.db, project.id);
    const role = projectRole(auth.subject, grants);
    if (!role) throw new NotFoundException();
    if (!can(role, 'project.share')) throw new ForbiddenException('Seul un admin du volume peut modifier ses accès.');
    if (project.archived_at) throw new ConflictException('Désarchivez le volume pour modifier ses accès.');
    return { project, grants };
  }

  /** Une personne active ou un groupe de l'espace. */
  private async principal(workspaceId: string, input: { type?: unknown; id?: unknown }) {
    if ((input.type !== 'user' && input.type !== 'group') || typeof input.id !== 'string' || !UUID.test(input.id)) throw new BadRequestException('Personne ou groupe invalide.');
    if (input.type === 'group') {
      const group = await this.db.selectFrom('groups').select(['id', 'name']).where('id', '=', input.id).where('workspace_id', '=', workspaceId).executeTakeFirst();
      if (!group) throw new BadRequestException('Ce groupe n’existe pas.');
      return { ref: { type: 'group', id: group.id } as PrincipalRef, name: group.name, guest: false };
    }
    const user = await this.db.selectFrom('users').select(['id', 'name', 'workspace_role', 'disabled_at']).where('id', '=', input.id).where('workspace_id', '=', workspaceId).executeTakeFirst();
    if (!user) throw new BadRequestException('Ce compte n’existe pas.');
    if (user.disabled_at) throw new BadRequestException(`Le compte de ${user.name} est désactivé.`);
    return { ref: { type: 'user', id: user.id } as PrincipalRef, name: user.name, guest: user.workspace_role === 'guest' };
  }

  /** Personne ne se retire l'administration d'un volume par mégarde: un autre admin doit le faire. */
  private keepSharing(auth: AuthContext, after: Grant[]) {
    if (!can(projectRole(auth.subject, after), 'project.share')) {
      throw new ConflictException('Vous perdriez l’administration de ce volume. Demandez à un autre admin de le faire.');
    }
  }

  async setGrant(auth: AuthContext, projectId: string, input: { type?: unknown; id?: unknown; role?: unknown }, ip: string) {
    const { project, grants } = await this.sharedProject(auth, projectId);
    const role = input.role as ProjectRole;
    if (!PROJECT_ROLES.includes(role)) throw new BadRequestException('Rôle inconnu.');
    const principal = await this.principal(project.workspace_id, input);
    if (principal.guest && role === 'admin') throw new BadRequestException(`${principal.name} est invité de l’espace: au plus éditeur d’un volume.`);

    const previous = grants.find((g) => same(g.principal, principal.ref));
    if (previous?.role === role) return;
    this.keepSharing(auth, [...grants.filter((g) => !same(g.principal, principal.ref)), { principal: principal.ref, role }]);

    await this.db
      .insertInto('project_members')
      .values({ project_id: project.id, principal_type: principal.ref.type, principal_id: principal.ref.id, role })
      .onConflict((oc) => oc.columns(['project_id', 'principal_type', 'principal_id']).doUpdateSet({ role }))
      .execute();
    await this.audit.record({
      workspaceId: project.workspace_id,
      actorId: auth.user.id,
      action: previous ? 'access.grant_changed' : 'access.grant_added',
      targetType: 'project',
      targetId: project.id,
      ip,
      metadata: { principal: principal.ref, from: previous?.role ?? null, to: role },
    });
    await this.bridge.accessChanged();
  }

  async removeGrant(auth: AuthContext, projectId: string, input: { type?: unknown; id?: unknown }, ip: string) {
    const { project, grants } = await this.sharedProject(auth, projectId);
    if ((input.type !== 'user' && input.type !== 'group') || typeof input.id !== 'string') throw new BadRequestException('Personne ou groupe invalide.');
    const ref = { type: input.type, id: input.id } as PrincipalRef;
    const previous = grants.find((g) => same(g.principal, ref));
    if (!previous) return;
    this.keepSharing(auth, grants.filter((g) => !same(g.principal, ref)));

    await this.db.deleteFrom('project_members').where('project_id', '=', project.id).where('principal_type', '=', ref.type).where('principal_id', '=', ref.id).execute();
    await this.audit.record({ workspaceId: project.workspace_id, actorId: auth.user.id, action: 'access.grant_removed', targetType: 'project', targetId: project.id, ip, metadata: { principal: ref, from: previous.role } });
    await this.bridge.accessChanged();
  }

  /**
   * Remplace la liste d'une restriction de la page (lecture ou écriture).
   * Une liste vide lève la restriction. L'acteur doit garder le droit de
   * restreindre: on ne s'enferme pas dehors.
   */
  async setRestriction(auth: AuthContext, pageId: string, kind: string, input: { principals?: unknown }, ip: string) {
    if (kind !== 'view' && kind !== 'edit') throw new NotFoundException();
    const access = await this.docs.require(auth.subject, pageId, 'page.read');
    if (!can(access.role, 'page.restrict')) throw new ForbiddenException('Il faut le droit d’écriture sur la page pour la restreindre.');
    if (!Array.isArray(input.principals) || input.principals.length > MAX_PRINCIPALS) throw new BadRequestException('Liste invalide.');

    const workspaceId = auth.user.workspace_id;
    const page = await this.db.selectFrom('pages').select(['id', 'path', 'project_id']).where('id', '=', pageId).executeTakeFirstOrThrow();
    const [grants, chain, before] = await Promise.all([
      projectGrants(this.db, page.project_id),
      this.db
        .selectFrom('page_restrictions as r')
        .innerJoin('pages as p', 'p.id', 'r.page_id')
        .select(['r.page_id', 'r.kind', 'r.principal_type', 'r.principal_id'])
        .where(({ eb, ref, val }) => eb(ref('p.path'), '@>', val(page.path)))
        .execute(),
      this.db.selectFrom('page_restrictions').select(['principal_type', 'principal_id']).where('page_id', '=', pageId).where('kind', '=', kind).execute(),
    ]);

    const principals: PrincipalRef[] = [];
    for (const raw of input.principals as { type?: unknown; id?: unknown }[]) {
      // Qui figure déjà dans la liste y reste, même désactivé depuis: on ne vérifie que les ajouts.
      const kept = before.find((b) => b.principal_type === raw?.type && b.principal_id === raw?.id);
      const ref: PrincipalRef = kept ? { type: kept.principal_type, id: kept.principal_id } : (await this.principal(workspaceId, raw ?? {})).ref;
      if (!principals.some((p) => same(p, ref))) principals.push(ref);
    }
    const after: Restriction[] = [
      ...chain.filter((r) => !(r.page_id === pageId && r.kind === kind)).map((r) => ({ pageId: r.page_id, kind: r.kind, principal: { type: r.principal_type, id: r.principal_id } })),
      ...principals.map((principal) => ({ pageId, kind: kind as RestrictionKind, principal })),
    ];
    if (!can(pageRole(auth.subject, grants, after), 'page.restrict')) {
      throw new ConflictException('Vous perdriez vous-même l’accès à cette page. Ajoutez-vous à la liste, ou un groupe dont vous faites partie.');
    }

    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('page_restrictions').where('page_id', '=', pageId).where('kind', '=', kind).execute();
      if (principals.length) {
        await trx
          .insertInto('page_restrictions')
          .values(principals.map((p) => ({ page_id: pageId, kind, principal_type: p.type, principal_id: p.id })))
          .execute();
      }
    });
    await this.audit.record({
      workspaceId,
      actorId: auth.user.id,
      action: principals.length === 0 ? 'access.restriction_lifted' : before.length === 0 ? 'access.restriction_added' : 'access.restriction_changed',
      targetType: 'page',
      targetId: pageId,
      ip,
      metadata: { kind, from: before.map((b) => ({ type: b.principal_type, id: b.principal_id })), to: principals },
    });
    await this.bridge.accessChanged();
  }
}
