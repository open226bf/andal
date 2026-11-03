import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common';
import type { Subject } from '@andal/authz';
import { linkSpecBlocks, type Database } from '@andal/db';
import { validateDoc, type JSONContent } from '@andal/editor';
import { fromMarkdown, toMarkdown } from '@andal/editor/markdown';
import type { Queue } from 'bullmq';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { DocsService } from '../docs/docs.service.js';
import { DB, QUEUE } from '../infra.module.js';

export type ContentInput = { content?: unknown; markdown?: unknown } | string;

/**
 * Contenu d'une page par l'API, en JSON (le document tel quel) ou en Markdown.
 * Écrire passe par le serveur collab: qui a la page ouverte reçoit le nouveau
 * contenu sur-le-champ, et l'historique garde une version au nom de l'auteur.
 */
@Injectable()
export class ContentService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly docs: DocsService,
    private readonly bridge: CollabBridgeService,
    private readonly audit: AuditService,
  ) {}

  async read(subject: Subject, pageId: string) {
    await this.docs.require(subject, pageId, 'page.read');
    const page = await this.db.selectFrom('pages').select(['id', 'title', 'content', 'version', 'updated_at']).where('id', '=', pageId).executeTakeFirstOrThrow();
    const content = page.content as JSONContent;
    return { id: page.id, title: page.title, version: page.version, updatedAt: page.updated_at.toISOString(), content, markdown: () => `# ${page.title}\n\n${toMarkdown(content)}` };
  }

  /**
   * Le document à enregistrer: JSON vérifié par le schéma, ou Markdown converti.
   * Un bloc ```openapi qui nomme une spec du volume est relié à sa dernière version.
   */
  async prepare(projectId: string, input: ContentInput): Promise<{ doc: JSONContent; format: 'json' | 'markdown' }> {
    let doc: JSONContent;
    let format: 'json' | 'markdown';
    if (typeof input === 'string') {
      doc = fromMarkdown(stripTitle(input));
      format = 'markdown';
    } else if (typeof input.markdown === 'string') {
      doc = fromMarkdown(stripTitle(input.markdown));
      format = 'markdown';
    } else if (input.content && typeof input.content === 'object') {
      doc = input.content as JSONContent;
      format = 'json';
    } else {
      throw new BadRequestException('Envoyez `{ "content": <document> }`, `{ "markdown": "…" }`, ou du Markdown brut (Content-Type: text/markdown).');
    }
    if (doc.type !== 'doc') throw new BadRequestException('Le document doit être de type « doc ».');
    doc = await linkSpecBlocks(this.db, projectId, doc);
    const problem = validateDoc(doc);
    if (problem) throw new BadRequestException(`Le document ne respecte pas le schéma d’Andal: ${problem}`);
    return { doc, format };
  }

  async replace(auth: AuthContext, pageId: string, input: ContentInput, ip: string) {
    const { projectId } = await this.docs.require(auth.subject, pageId, 'page.edit');
    const { doc, format } = await this.prepare(projectId, input);
    const reply = await this.bridge.replace(pageId, doc, auth.user.id);
    if (reply === 'invalid') throw new BadRequestException('Le document ne respecte pas le schéma d’Andal.');
    if (reply !== 'ok' && reply !== 'same') throw new HttpException('Le serveur de collaboration ne répond pas. Réessayez dans un instant.', 503);
    if (reply === 'ok') {
      await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'page.content_replaced', targetType: 'page', targetId: pageId, ip, metadata: { format, via: auth.token ? 'token' : 'session' } });
    }
    return { updated: reply === 'ok' };
  }

  /** Une page créée par l'API avec son contenu: index de recherche et liens tout de suite. */
  async indexLater(pageId: string) {
    await this.queue.add('page.index', { pageId }, { removeOnComplete: 100, removeOnFail: 500 });
  }
}

/** Un `# Titre` en tête est le titre de la page (déjà porté par la page), pas un intertitre. */
function stripTitle(markdown: string): string {
  return markdown.replace(/^\uFEFF?\s*#\s+[^\n]*\n+/, '');
}
