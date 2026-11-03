import { HttpException, Inject, Injectable, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import type { Subject } from '@andal/authz';
import { sniffImage, Storage, type Database } from '@andal/db';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Readable } from 'node:stream';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { DocsService } from '../docs/docs.service.js';
import { config } from '../env.js';
import { DB, STORAGE } from '../infra.module.js';

export interface UploadedFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** Image affichable dans la page (sinon: pièce jointe à télécharger). */
  image: boolean;
}

export interface OpenedFile {
  name: string;
  contentType: string;
  size: number;
  inline: boolean;
  stream: Readable;
}

/** Nom affichable: sans chemin ni caractère de contrôle, 180 caractères au plus. */
function cleanName(raw: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  const name = basename((raw ?? '').replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || 'fichier').slice(0, 180);
}

/**
 * Fichiers envoyés sur les pages. Envoyer demande le droit d'écriture sur la
 * page; lire, le droit de lecture. Un fichier d'une page illisible répond 404,
 * comme un fichier inexistant.
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(STORAGE) private readonly storage: Storage | null,
    private readonly docs: DocsService,
    private readonly audit: AuditService,
  ) {}

  async upload(auth: AuthContext, pageId: string, req: FastifyRequest, ip: string): Promise<UploadedFile> {
    await this.docs.require(auth.subject, pageId, 'page.edit');
    if (!this.storage) throw new ServiceUnavailableException("L'envoi de fichiers n'est pas configuré sur ce serveur (S3_BUCKET).");
    if (!req.isMultipart()) throw new BadRequestException('Envoyez le fichier en multipart/form-data.');

    const part = await req.file({ limits: { fileSize: config.uploadMaxBytes, files: 1 } });
    if (!part) throw new BadRequestException('Aucun fichier reçu.');
    let body: Buffer;
    try {
      body = await part.toBuffer();
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new PayloadTooLargeException(`Fichier trop lourd: ${Math.round(config.uploadMaxBytes / 1024 / 1024)} Mo au plus.`);
      }
      throw error;
    }
    if (body.length === 0) throw new BadRequestException('Le fichier est vide.');

    const name = cleanName(part.filename);
    const imageType = sniffImage(body, part.mimetype);
    // Un fichier qui se dit image sans en avoir la signature est une pièce jointe opaque, jamais affichée.
    const declared = /^[\w.+-]+\/[\w.+-]+$/.test(part.mimetype) && !part.mimetype.startsWith('image/') ? part.mimetype : 'application/octet-stream';
    const contentType = imageType ?? declared;
    const id = randomUUID();
    const key = `pages/${pageId}/${id}`;

    try {
      await this.storage.put(key, body, contentType);
    } catch (error) {
      console.error('Envoi vers le stockage en échec:', error);
      throw new HttpException('Le stockage des fichiers ne répond pas. Réessayez dans un instant.', 503);
    }
    await this.db.insertInto('attachments').values({ id, page_id: pageId, name, content_type: contentType, size: body.length, storage_key: key, created_by: auth.user.id }).execute();
    await this.audit.record({
      workspaceId: auth.user.workspace_id,
      actorId: auth.user.id,
      action: 'file.uploaded',
      targetType: 'attachment',
      targetId: id,
      ip,
      metadata: { pageId, name, size: body.length, contentType },
    });
    return { id, name, contentType, size: body.length, image: imageType !== null };
  }

  async open(subject: Subject, fileId: string): Promise<OpenedFile> {
    const file = await this.db.selectFrom('attachments').selectAll().where('id', '=', fileId).executeTakeFirst();
    if (!file) throw new NotFoundException();
    await this.docs.require(subject, file.page_id, 'page.read');
    if (!this.storage) throw new ServiceUnavailableException("Le stockage des fichiers n'est pas configuré.");
    let stream: Readable;
    try {
      stream = await this.storage.get(file.storage_key);
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') throw new NotFoundException();
      throw new HttpException('Le stockage des fichiers ne répond pas.', 503);
    }
    return { name: file.name, contentType: file.content_type, size: file.size, inline: file.content_type.startsWith('image/'), stream };
  }
}
