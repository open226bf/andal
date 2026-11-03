import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { can, canDeleteComment, commentRecipients, type Subject } from '@andal/authz';
import { mentionedUsernames, pageRolesForAll, type Database } from '@andal/db';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { DocsService } from '../docs/docs.service.js';
import { DB } from '../infra.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EventsService } from '../webhooks/events.service.js';

const BODY_MAX = 4000;
/** Position relative Yjs encodée en base64: quelques dizaines d'octets. */
const RELATIVE_POSITION = /^[A-Za-z0-9+/]+={0,2}$/;

function body(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BadRequestException('Le commentaire est vide.');
  if (text.length > BODY_MAX) throw new BadRequestException(`Un commentaire fait au plus ${BODY_MAX} caractères.`);
  return text;
}

function position(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || !RELATIVE_POSITION.test(value)) throw new BadRequestException('Ancre invalide.');
  return value;
}

/**
 * Fils de commentaires. Lire une page suffit pour voir ses fils; il faut le
 * droit `page.comment` pour écrire, répondre ou résoudre.
 */
@Injectable()
export class CommentsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly docs: DocsService,
    private readonly bridge: CollabBridgeService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  private async announceToIntegrations(auth: AuthContext, pageId: string, commentId: string) {
    const page = await this.db.selectFrom('pages').select('project_id').where('id', '=', pageId).executeTakeFirst();
    if (page) await this.events.emit({ event: 'comment.created', workspaceId: auth.user.workspace_id, projectId: page.project_id, actorId: auth.user.id, pageId, commentId });
  }

  /** Droit de commenter, avec un message clair pour qui ne peut que lire. */
  private async requireComment(subject: Subject, pageId: string) {
    const access = await this.docs.require(subject, pageId, 'page.read');
    if (!can(access.role, 'page.comment')) throw new ForbiddenException('Vous ne pouvez que lire cette page.');
    return access;
  }

  private async thread(threadId: string) {
    const thread = await this.db.selectFrom('comment_threads').selectAll().where('id', '=', threadId).executeTakeFirst();
    if (!thread) throw new NotFoundException();
    return thread;
  }

  /** Qui citer sur cette page: les comptes actifs qui peuvent la lire et ont un identifiant. */
  async mentionable(subject: Subject, pageId: string) {
    await this.docs.require(subject, pageId, 'page.read');
    const readers = await pageRolesForAll(this.db, pageId);
    if (readers.size === 0) return [];
    const users = await this.db
      .selectFrom('users')
      .select(['id', 'name', 'username', 'initials', 'color'])
      .where('id', 'in', [...readers.keys()])
      .where('username', 'is not', null)
      .orderBy('name')
      .execute();
    return users.map((u) => ({ id: u.id, name: u.name, username: u.username!, initials: u.initials, color: u.color, you: u.id === subject.userId }));
  }

  /**
   * Enregistre les citations d'un nouveau message et prévient qui doit l'être:
   * les personnes citées, puis les autres participants du fil. Une personne
   * citée qui ne peut pas lire la page n'est pas prévenue; l'auteur en est averti.
   */
  private async announce(auth: AuthContext, pageId: string, threadId: string, commentId: string, text: string): Promise<{ unreachable: string[] }> {
    const names = mentionedUsernames(text);
    const [mentioned, readers, previous] = await Promise.all([
      names.length
        ? this.db
            .selectFrom('users')
            .select(['id', 'name'])
            .where('workspace_id', '=', auth.user.workspace_id)
            .where('disabled_at', 'is', null)
            .where(sql<string>`lower(username)`, 'in', names)
            .execute()
        : [],
      pageRolesForAll(this.db, pageId),
      this.db.selectFrom('comments').select('author_id').where('thread_id', '=', threadId).where('id', '!=', commentId).orderBy('created_at').execute(),
    ]);
    const reachable = mentioned.filter((m) => readers.has(m.id));
    if (reachable.length) {
      await this.db.insertInto('comment_mentions').values(reachable.map((m) => ({ comment_id: commentId, user_id: m.id }))).onConflict((oc) => oc.doNothing()).execute();
    }
    const recipients = commentRecipients({ authorId: auth.user.id, mentioned: reachable.map((m) => m.id), participants: previous.map((p) => p.author_id) }, (id) => readers.has(id));
    await this.notifications.create(recipients.map((r) => ({ userId: r.userId, kind: r.kind, actorId: auth.user.id, pageId, threadId, commentId })));
    return { unreachable: mentioned.filter((m) => !readers.has(m.id) && m.id !== auth.user.id).map((m) => m.name) };
  }

  async list(subject: Subject, pageId: string) {
    const access = await this.docs.require(subject, pageId, 'page.read');
    const [threads, comments, mentions] = await Promise.all([
      this.db
        .selectFrom('comment_threads as t')
        .leftJoin('users as r', 'r.id', 't.resolved_by')
        .select(['t.id', 't.resolved_at', 't.created_at', 'r.name as resolved_by'])
        .where('t.page_id', '=', pageId)
        .orderBy('t.created_at')
        .execute(),
      this.db
        .selectFrom('comments as c')
        .innerJoin('comment_threads as t', 't.id', 'c.thread_id')
        .innerJoin('users as u', 'u.id', 'c.author_id')
        .select(['c.id', 'c.thread_id', 'c.body', 'c.created_at', 'u.id as author_id', 'u.name', 'u.initials', 'u.color'])
        .where('t.page_id', '=', pageId)
        .orderBy('c.created_at')
        .execute(),
      this.db
        .selectFrom('comment_mentions as m')
        .innerJoin('comments as c', 'c.id', 'm.comment_id')
        .innerJoin('comment_threads as t', 't.id', 'c.thread_id')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['m.comment_id', 'u.id', 'u.name', 'u.username'])
        .where('t.page_id', '=', pageId)
        .execute(),
    ]);
    const canComment = can(access.role, 'page.comment');
    return threads.map((t) => ({
      id: t.id,
      resolvedAt: t.resolved_at ? new Date(t.resolved_at).toISOString() : null,
      resolvedBy: t.resolved_by,
      canReply: canComment,
      comments: comments
        .filter((c) => c.thread_id === t.id)
        .map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: new Date(c.created_at).toISOString(),
          author: { id: c.author_id, name: c.name, initials: c.initials, color: c.color },
          mentions: mentions.filter((m) => m.comment_id === c.id && m.username).map((m) => ({ id: m.id, name: m.name, username: m.username!, you: m.id === subject.userId })),
          canDelete: canDeleteComment(access.role, c.author_id === subject.userId),
        })),
    }));
  }

  /** Ouvre un fil sur un passage: le serveur collab pose l'ancre, sinon rien n'est créé. */
  async create(auth: AuthContext, pageId: string, input: { body?: unknown; anchor?: { from?: unknown; to?: unknown } }, ip: string) {
    await this.requireComment(auth.subject, pageId);
    const text = body(input.body);
    const from = position(input.anchor?.from);
    const to = position(input.anchor?.to);

    const thread = await this.db.transaction().execute(async (trx) => {
      const created = await trx.insertInto('comment_threads').values({ page_id: pageId, created_by: auth.user.id }).returning('id').executeTakeFirstOrThrow();
      const first = await trx.insertInto('comments').values({ thread_id: created.id, author_id: auth.user.id, body: text }).returning('id').executeTakeFirstOrThrow();
      return { id: created.id, commentId: first.id };
    });

    const result = await this.bridge.anchor(pageId, thread.id, from, to);
    if (result !== 'ok') {
      await this.db.deleteFrom('comment_threads').where('id', '=', thread.id).execute();
      if (result === 'timeout') throw new ServiceUnavailableException('Le serveur de collaboration ne répond pas. Réessayez dans un instant.');
      throw new UnprocessableEntityException('Le passage a changé entre-temps, ou couvre plusieurs paragraphes. Sélectionnez-le de nouveau.');
    }
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'comment.thread_created', targetType: 'page', targetId: pageId, ip, metadata: { threadId: thread.id } });
    const { unreachable } = await this.announce(auth, pageId, thread.id, thread.commentId, text);
    await this.bridge.notifyThreads(pageId);
    await this.announceToIntegrations(auth, pageId, thread.commentId);
    return { id: thread.id, unreachable };
  }

  async reply(auth: AuthContext, threadId: string, input: { body?: unknown }, ip: string) {
    const thread = await this.thread(threadId);
    await this.requireComment(auth.subject, thread.page_id);
    if (thread.resolved_at) throw new ConflictException('Rouvrez le fil pour y répondre.');
    const text = body(input.body);
    const created = await this.db.insertInto('comments').values({ thread_id: thread.id, author_id: auth.user.id, body: text }).returning('id').executeTakeFirstOrThrow();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'comment.replied', targetType: 'page', targetId: thread.page_id, ip, metadata: { threadId } });
    const { unreachable } = await this.announce(auth, thread.page_id, thread.id, created.id, text);
    await this.bridge.notifyThreads(thread.page_id);
    await this.announceToIntegrations(auth, thread.page_id, created.id);
    return { id: created.id, unreachable };
  }

  async setResolved(auth: AuthContext, threadId: string, resolved: boolean, ip: string) {
    const thread = await this.thread(threadId);
    await this.requireComment(auth.subject, thread.page_id);
    if (Boolean(thread.resolved_at) === resolved) return;
    await this.db
      .updateTable('comment_threads')
      .set(resolved ? { resolved_at: new Date(), resolved_by: auth.user.id } : { resolved_at: null, resolved_by: null })
      .where('id', '=', thread.id)
      .execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: resolved ? 'comment.thread_resolved' : 'comment.thread_reopened', targetType: 'page', targetId: thread.page_id, ip, metadata: { threadId } });
    // Qui a ouvert le fil apprend qu'un autre l'a résolu (s'il lit toujours la page).
    if (resolved && thread.created_by && thread.created_by !== auth.user.id) {
      const [readers, first] = await Promise.all([
        pageRolesForAll(this.db, thread.page_id),
        this.db.selectFrom('comments').select('id').where('thread_id', '=', thread.id).orderBy('created_at').limit(1).executeTakeFirst(),
      ]);
      if (readers.has(thread.created_by)) {
        await this.notifications.create([{ userId: thread.created_by, kind: 'resolved', actorId: auth.user.id, pageId: thread.page_id, threadId: thread.id, commentId: first?.id ?? null }]);
      }
    }
    await this.bridge.notifyThreads(thread.page_id);
  }

  /**
   * Supprimer une réponse la retire. Supprimer le premier commentaire supprime
   * le fil et son ancre, sauf si d'autres y ont répondu (un admin du volume le peut quand même).
   */
  async remove(auth: AuthContext, commentId: string, ip: string) {
    const comment = await this.db
      .selectFrom('comments as c')
      .innerJoin('comment_threads as t', 't.id', 'c.thread_id')
      .select(['c.id', 'c.author_id', 'c.thread_id', 't.page_id'])
      .where('c.id', '=', commentId)
      .executeTakeFirst();
    if (!comment) throw new NotFoundException();
    const access = await this.docs.require(auth.subject, comment.page_id, 'page.read');
    if (!canDeleteComment(access.role, comment.author_id === auth.user.id)) throw new ForbiddenException('Vous ne pouvez supprimer que vos propres commentaires.');

    const siblings = await this.db.selectFrom('comments').select(['id', 'author_id']).where('thread_id', '=', comment.thread_id).orderBy('created_at').execute();
    const isFirst = siblings[0]?.id === comment.id;
    if (isFirst) {
      const othersReplied = siblings.some((c) => c.author_id !== comment.author_id);
      if (othersReplied && !can(access.role, 'project.manage')) throw new ConflictException("D'autres ont répondu: résolvez le fil plutôt que de le supprimer.");
      await this.db.deleteFrom('comment_threads').where('id', '=', comment.thread_id).execute();
      // Sans fil, l'ancre n'a plus de sens. Si le serveur collab ne répond pas, la marque orpheline est simplement ignorée.
      await this.bridge.unanchor(comment.page_id, comment.thread_id);
    } else {
      await this.db.deleteFrom('comments').where('id', '=', comment.id).execute();
    }
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: isFirst ? 'comment.thread_deleted' : 'comment.deleted', targetType: 'page', targetId: comment.page_id, ip, metadata: { threadId: comment.thread_id } });
    await this.bridge.notifyThreads(comment.page_id);
  }
}
