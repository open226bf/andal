import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { can } from '@andal/authz';
import { pageRoleFor, type Database, type NotificationKind } from '@andal/db';
import type { Queue } from 'bullmq';
import type { Kysely } from 'kysely';
import type { AuthContext } from '../auth/auth.guard.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { config } from '../env.js';
import { DB, QUEUE } from '../infra.module.js';
import { MailService } from '../mail.service.js';

const EXCERPT = 160;
const INBOX_SIZE = 50;

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  actorId: string;
  pageId: string;
  threadId: string;
  commentId: string | null;
}

function excerpt(body: string | null): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1)}…` : flat;
}

/**
 * Notifications: une citation, une réponse dans un fil suivi, un fil résolu.
 * À l'affichage, chaque page est relue avec les droits du moment: qui a perdu
 * l'accès à une page ne voit plus ce qui s'y dit.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly bridge: CollabBridgeService,
    private readonly mail: MailService,
  ) {}

  /** Enregistre, prévient les navigateurs ouverts, et programme l'email de rattrapage. */
  async create(rows: NewNotification[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insertInto('notifications')
      .values(rows.map((r) => ({ user_id: r.userId, kind: r.kind, actor_id: r.actorId, page_id: r.pageId, thread_id: r.threadId, comment_id: r.commentId })))
      .execute();
    const userIds = [...new Set(rows.map((r) => r.userId))];
    await this.bridge.notify(userIds);
    if (!this.mail.enabled) return;
    for (const userId of userIds) {
      // Même identifiant de tâche: tant qu'un email attend, les suivantes s'y regroupent.
      await this.queue.add('notifications.email', { userId }, { jobId: `notify-email-${userId}`, delay: config.notifyEmailDelaySeconds * 1000, removeOnComplete: true, removeOnFail: true });
    }
  }

  async list(auth: AuthContext) {
    const rows = await this.db
      .selectFrom('notifications as n')
      .innerJoin('pages as p', 'p.id', 'n.page_id')
      .innerJoin('projects as pr', 'pr.id', 'p.project_id')
      .leftJoin('users as a', 'a.id', 'n.actor_id')
      .leftJoin('comments as c', 'c.id', 'n.comment_id')
      .select([
        'n.id',
        'n.kind',
        'n.created_at',
        'n.read_at',
        'n.page_id',
        'n.thread_id',
        'p.title',
        'pr.slug',
        'pr.short_name',
        'pr.cloth',
        'a.name as actor_name',
        'a.initials as actor_initials',
        'a.color as actor_color',
        'c.body',
      ])
      .where('n.user_id', '=', auth.user.id)
      .orderBy('n.created_at', 'desc')
      .limit(INBOX_SIZE)
      .execute();

    const readable = new Map<string, boolean>();
    for (const pageId of new Set(rows.map((r) => r.page_id))) {
      const access = await pageRoleFor(this.db, auth.subject, pageId);
      readable.set(pageId, can(access?.role ?? null, 'page.read'));
    }
    const items = rows
      .filter((r) => readable.get(r.page_id))
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        createdAt: new Date(r.created_at).toISOString(),
        read: r.read_at !== null,
        actor: r.actor_name ? { name: r.actor_name, initials: r.actor_initials!, color: r.actor_color! } : null,
        page: { id: r.page_id, title: r.title, slug: r.slug, shortName: r.short_name, cloth: r.cloth },
        threadId: r.thread_id,
        excerpt: excerpt(r.body),
      }));
    return {
      unread: items.filter((i) => !i.read).length,
      items,
      email: { available: this.mail.enabled, enabled: auth.user.notify_email },
    };
  }

  /** Marque comme lues les notifications données, ou toutes. Les autres onglets se mettent à jour. */
  async markRead(auth: AuthContext, ids: unknown): Promise<void> {
    let query = this.db.updateTable('notifications').set({ read_at: new Date() }).where('user_id', '=', auth.user.id).where('read_at', 'is', null);
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.length > INBOX_SIZE || ids.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))) throw new BadRequestException('Liste invalide.');
      if (ids.length === 0) return;
      query = query.where('id', 'in', ids as string[]);
    }
    const updated = await query.returning('id').execute();
    if (updated.length) await this.bridge.notify([auth.user.id]);
  }

  async setEmail(auth: AuthContext, enabled: unknown): Promise<void> {
    if (typeof enabled !== 'boolean') throw new BadRequestException('Valeur invalide.');
    await this.db.updateTable('users').set({ notify_email: enabled }).where('id', '=', auth.user.id).execute();
  }
}
