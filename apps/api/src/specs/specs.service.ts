import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { archivedRole, can, projectRole, type Subject } from '@andal/authz';
import { projectGrants, specHash, type Database } from '@andal/db';
import { checkSpec, listOperations, operationFromSpec, specInfo } from '@andal/editor';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart';
import type { Kysely } from 'kysely';
import { parse } from 'yaml';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { DB } from '../infra.module.js';
import { EventsService } from '../webhooks/events.service.js';

/** Une spec dépasse rarement quelques centaines de Ko; au-delà, c'est une erreur d'envoi. */
export const SPEC_MAX_BYTES = 2 * 1024 * 1024;

/** Nom court d'une spec: minuscules, chiffres, tirets (« paiements », « auth-v2 »). */
function specName(raw: unknown): string {
  const name = String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(ya?ml|json)$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!name) throw new BadRequestException('Donnez un nom court à la spec (?name=paiements).');
  return name;
}

/** Analyse le texte envoyé (YAML ou JSON, le JSON étant du YAML) et le réduit à du JSON pur. */
function parseSpec(text: string): Record<string, unknown> {
  let doc: unknown;
  try {
    // maxAliasCount borne les ancres YAML imbriquées (« billion laughs »).
    doc = parse(text, { maxAliasCount: 100, prettyErrors: false });
  } catch (error) {
    throw new BadRequestException(`Le fichier ne se lit ni en YAML ni en JSON: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  const problem = checkSpec(doc);
  if (problem) throw new BadRequestException(problem);
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

/**
 * Specs OpenAPI d'un volume. Les lire demande l'accès au volume; publier, le
 * droit de créer des pages (éditeur); supprimer, l'administration du volume.
 * Republier sous le même nom ajoute une version, sauf si rien n'a changé.
 */
@Injectable()
export class SpecsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** Le volume, le rôle effectif (archivé: lecture seule) et le rôle d'origine; 404 sans accès. */
  private async access(subject: Subject, workspaceId: string, projectId: string) {
    const project = await this.db.selectFrom('projects').select(['id', 'slug', 'name', 'short_name', 'archived_at']).where('id', '=', projectId).where('workspace_id', '=', workspaceId).executeTakeFirst();
    const original = project ? projectRole(subject, await projectGrants(this.db, project.id)) : null;
    if (!project || !original) throw new NotFoundException();
    return { project, role: archivedRole(original, project.archived_at !== null)!, original };
  }

  private async specAccess(subject: Subject, workspaceId: string, specId: string) {
    const spec = await this.db.selectFrom('api_specs').selectAll().where('id', '=', specId).executeTakeFirst();
    if (!spec) throw new NotFoundException();
    return { spec, ...(await this.access(subject, workspaceId, spec.project_id)) };
  }

  private async version(specId: string, sequence?: number) {
    let query = this.db.selectFrom('api_spec_versions').selectAll().where('spec_id', '=', specId);
    query = sequence ? query.where('sequence', '=', sequence) : query.orderBy('sequence', 'desc').limit(1);
    const version = await query.executeTakeFirst();
    if (!version) throw new NotFoundException(sequence ? `La spec n'a pas de version ${sequence}.` : undefined);
    return version;
  }

  async list(subject: Subject, workspaceId: string, projectId: string) {
    const { role } = await this.access(subject, workspaceId, projectId);
    const specs = await this.db
      .selectFrom('api_specs as s')
      .innerJoin('api_spec_versions as v', (j) => j.onRef('v.spec_id', '=', 's.id').on('v.sequence', '=', (eb) => eb.selectFrom('api_spec_versions').select((e) => e.fn.max('sequence').as('m')).whereRef('spec_id', '=', 's.id')))
      .select(['s.id', 's.name', 's.title', 's.updated_at', 'v.sequence', 'v.label', 'v.content'])
      .where('s.project_id', '=', projectId)
      .orderBy('s.name')
      .execute();
    return {
      canPublish: can(role, 'page.create'),
      specs: specs.map((s) => ({ id: s.id, name: s.name, title: s.title, label: s.label, sequence: s.sequence, operationCount: listOperations(s.content).length, updatedAt: s.updated_at.toISOString() })),
    };
  }

  async get(subject: Subject, workspaceId: string, specId: string) {
    const { spec, project, role, original } = await this.specAccess(subject, workspaceId, specId);
    const versions = await this.db
      .selectFrom('api_spec_versions as v')
      .leftJoin('users as u', 'u.id', 'v.created_by')
      .select(['v.sequence', 'v.label', 'v.created_at', 'u.name as author'])
      .where('v.spec_id', '=', specId)
      .orderBy('v.sequence', 'desc')
      .execute();
    return {
      id: spec.id,
      name: spec.name,
      title: spec.title,
      project: { id: project.id, slug: project.slug, name: project.name, shortName: project.short_name },
      versions: versions.map((v) => ({ sequence: v.sequence, label: v.label, createdAt: v.created_at.toISOString(), author: v.author })),
      canPublish: can(role, 'page.create'),
      canDelete: can(original, 'project.manage'),
    };
  }

  async document(subject: Subject, workspaceId: string, specId: string, sequence?: number) {
    await this.specAccess(subject, workspaceId, specId);
    return (await this.version(specId, sequence)).content;
  }

  async operations(subject: Subject, workspaceId: string, specId: string, sequence?: number) {
    await this.specAccess(subject, workspaceId, specId);
    return listOperations((await this.version(specId, sequence)).content);
  }

  /** L'opération telle que l'affiche le bloc de page, avec la version d'où elle vient. */
  async operation(subject: Subject, workspaceId: string, specId: string, key: string, sequence?: number) {
    const { spec } = await this.specAccess(subject, workspaceId, specId);
    const version = await this.version(specId, sequence);
    const operation = operationFromSpec(version.content, key);
    if (!operation) throw new NotFoundException(`« ${key} » n'existe plus dans la version ${version.label || version.sequence} de ${spec.name}.`);
    return { operation, specName: spec.name, title: spec.title, sequence: version.sequence, label: version.label };
  }

  /**
   * Publie une spec: corps YAML ou JSON brut, objet JSON, ou multipart (un fichier).
   * Le nom vient de `?name=`, sinon du nom du fichier.
   */
  async publish(auth: AuthContext, projectId: string, nameParam: string | undefined, req: FastifyRequest, body: unknown, ip: string) {
    const { project, role } = await this.access(auth.subject, auth.user.workspace_id, projectId);
    if (!can(role, 'page.create')) throw new ForbiddenException(project.archived_at ? 'Volume archivé: lecture seule.' : 'Publier une spec demande le droit d’écriture sur le volume.');

    let doc: Record<string, unknown>;
    let fileName: string | undefined;
    if (req.isMultipart()) {
      const part = await req.file({ limits: { fileSize: SPEC_MAX_BYTES, files: 1 } });
      if (!part) throw new BadRequestException('Aucun fichier reçu.');
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch (error) {
        if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new PayloadTooLargeException('Spec trop lourde: 2 Mo au plus.');
        throw error;
      }
      fileName = part.filename;
      doc = parseSpec(buffer.toString('utf8'));
    } else if (typeof body === 'string') {
      doc = parseSpec(body);
    } else if (body && typeof body === 'object') {
      const problem = checkSpec(body);
      if (problem) throw new BadRequestException(problem);
      doc = body as Record<string, unknown>;
    } else {
      throw new BadRequestException('Envoyez la spec en YAML ou en JSON (corps de la requête ou fichier multipart).');
    }

    const name = specName(nameParam || fileName);
    const { title, version: label } = specInfo(doc);
    const hash = specHash(doc);

    const result = await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('api_specs')
        .values({ project_id: projectId, name, title, created_by: auth.user.id })
        .onConflict((oc) => oc.columns(['project_id', 'name']).doNothing())
        .execute();
      // Verrou: deux publications simultanées du même nom ne se marchent pas dessus.
      const spec = await trx.selectFrom('api_specs').selectAll().where('project_id', '=', projectId).where('name', '=', name).forUpdate().executeTakeFirstOrThrow();
      const last = await trx.selectFrom('api_spec_versions').select(['sequence', 'label', 'content_hash']).where('spec_id', '=', spec.id).orderBy('sequence', 'desc').limit(1).executeTakeFirst();
      if (last?.content_hash === hash) return { id: spec.id, sequence: last.sequence, label: last.label, created: false };
      const sequence = (last?.sequence ?? 0) + 1;
      await trx.insertInto('api_spec_versions').values({ spec_id: spec.id, sequence, label, content: JSON.stringify(doc), content_hash: hash, created_by: auth.user.id }).execute();
      await trx.updateTable('api_specs').set({ title, updated_at: new Date() }).where('id', '=', spec.id).execute();
      return { id: spec.id, sequence, label, created: true };
    });

    if (result.created) {
      await this.audit.record({
        workspaceId: auth.user.workspace_id,
        actorId: auth.user.id,
        action: 'spec.published',
        targetType: 'api_spec',
        targetId: result.id,
        ip,
        metadata: { projectId, name, sequence: result.sequence, label },
      });
      await this.events.emit({ event: 'spec.published', workspaceId: auth.user.workspace_id, projectId, actorId: auth.user.id, specId: result.id });
    }
    return { id: result.id, name, title, sequence: result.sequence, label: result.label, unchanged: !result.created, operationCount: listOperations(doc).length };
  }

  async remove(auth: AuthContext, specId: string, ip: string) {
    const { spec, original } = await this.specAccess(auth.subject, auth.user.workspace_id, specId);
    if (!can(original, 'project.manage')) throw new ForbiddenException('Réservé aux admins du volume.');
    await this.db.deleteFrom('api_specs').where('id', '=', specId).execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'spec.deleted', targetType: 'api_spec', targetId: specId, ip, metadata: { projectId: spec.project_id, name: spec.name } });
  }
}
