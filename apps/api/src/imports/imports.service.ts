import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { can } from '@andal/authz';
import { projectRoleFor, translateMessage, type Database, type Storage } from '@andal/db';
import type { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { DocsService } from '../docs/docs.service.js';
import { config } from '../env.js';
import { DB, QUEUE, STORAGE } from '../infra.module.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCEPTED = /\.(zip|md|markdown|html?)$/i;

export interface ImportView {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  source: string | null;
  fileName: string;
  pages: number;
  files: number;
  firstPageId: string | null;
  warnings: string[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * Imports d'archives: l'API reçoit le fichier, le range dans le stockage et
 * confie le travail au worker. Importer, c'est créer des pages: il faut le
 * droit d'écriture sur la destination (le volume, ou la page parente).
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(STORAGE) private readonly storage: Storage | null,
    private readonly docs: DocsService,
    private readonly audit: AuditService,
  ) {}

  /** multipart/form-data: le champ `parentId` (facultatif) avant le fichier. */
  async start(auth: AuthContext, projectId: string, req: FastifyRequest, ip: string): Promise<ImportView> {
    if (!this.storage) throw new ServiceUnavailableException("L'import demande le stockage des fichiers (S3_BUCKET), absent sur ce serveur.");
    if (!req.isMultipart()) throw new BadRequestException('Envoyez l’archive en multipart/form-data.');
    const project = await this.db.selectFrom('projects').select(['id', 'archived_at']).where('id', '=', projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    const role = project ? await projectRoleFor(this.db, auth.subject, project.id) : null;
    if (!project || !role) throw new NotFoundException();
    if (project.archived_at) throw new ForbiddenException('Ce volume est archivé: rien ne s’y ajoute.');

    let parentId: string | null = null;
    let file: { name: string; body: Buffer } | null = null;
    try {
      for await (const part of req.parts({ limits: { fileSize: config.importMaxBytes, files: 1, fields: 4 } })) {
        if (part.type === 'field' && part.fieldname === 'parentId' && typeof part.value === 'string' && part.value) parentId = part.value;
        if (part.type === 'file') file = { name: basename((part.filename ?? '').replaceAll('\\', '/')).slice(0, 200), body: await part.toBuffer() };
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new PayloadTooLargeException(`Archive trop lourde: ${Math.round(config.importMaxBytes / 1024 / 1024)} Mo au plus.`);
      throw error;
    }
    if (!file || file.body.length === 0) throw new BadRequestException('Aucun fichier reçu.');
    if (!ACCEPTED.test(file.name)) throw new BadRequestException('Formats acceptés : archive .zip (Markdown, Notion, Confluence), fichier .md ou page .html.');

    // La destination: une page du volume où l'on peut écrire, ou le premier niveau.
    if (parentId) {
      if (!UUID.test(parentId)) throw new BadRequestException('Page de destination invalide.');
      const access = await this.docs.require(auth.subject, parentId, 'page.read');
      if (access.projectId !== project.id) throw new BadRequestException('La page de destination est dans un autre volume.');
      if (!can(access.role, 'page.create')) throw new ForbiddenException('Il faut le droit d’écriture sur la page de destination.');
    } else if (!can(role, 'page.create')) {
      throw new ForbiddenException('Il faut le droit d’écriture sur le volume pour y importer des pages.');
    }

    const id = randomUUID();
    const key = `imports/${id}`;
    try {
      await this.storage.put(key, file.body, 'application/octet-stream');
    } catch (error) {
      console.error('Import: envoi vers le stockage en échec:', error);
      throw new HttpException('Le stockage des fichiers ne répond pas. Réessayez dans un instant.', 503);
    }
    await this.db.insertInto('imports').values({ id, workspace_id: auth.user.workspace_id, project_id: project.id, parent_id: parentId, created_by: auth.user.id, file_name: file.name, storage_key: key }).execute();
    await this.queue.add('import.run', { importId: id }, { jobId: `import-${id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'import.started', targetType: 'project', targetId: project.id, ip, metadata: { importId: id, file: file.name, size: file.body.length, parentId } });
    return this.get(auth, id);
  }

  /** Où en est un import: pour qui l'a lancé, ou un admin du volume. */
  async get(auth: AuthContext, importId: string): Promise<ImportView> {
    const row = await this.db.selectFrom('imports').selectAll().where('id', '=', importId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    if (!row) throw new NotFoundException();
    if (row.created_by !== auth.user.id && !can(await projectRoleFor(this.db, auth.subject, row.project_id), 'project.manage')) throw new NotFoundException();
    return {
      id: row.id,
      status: row.status,
      source: row.source,
      fileName: row.file_name,
      pages: row.pages,
      files: row.files,
      firstPageId: row.first_page_id,
      // Rédigés par le worker en français: traduits pour qui lit l'interface dans une autre langue.
      warnings: row.warnings.map((w) => translateMessage(w, auth.user.locale)),
      error: row.error ? translateMessage(row.error, auth.user.locale) : null,
      createdAt: row.created_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null,
    };
  }
}
