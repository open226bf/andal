import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { canManageAccounts } from '@andal/authz';
import { deliverWebhook, newWebhookSecret, pingPayload, WEBHOOK_EVENTS, webhookRequest, webhookUrlProblem, type Database, type WebhookEvent, type WebhookKind } from '@andal/db';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { config } from '../env.js';
import { DB } from '../infra.module.js';

const KINDS: WebhookKind[] = ['generic', 'slack', 'teams'];

interface WebhookInput {
  name?: unknown;
  url?: unknown;
  kind?: unknown;
  projectId?: unknown;
  events?: unknown;
  active?: unknown;
}

/**
 * Intégrations de l'espace (webhooks), gérées par ses admins. Une page sous
 * restriction de lecture n'est jamais annoncée: un canal Slack est souvent
 * plus large que la liste de qui peut la lire.
 */
@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  private admin(auth: AuthContext) {
    if (!canManageAccounts(auth.user.workspace_role)) throw new ForbiddenException("Réservé aux admins de l'espace.");
  }

  private async owned(auth: AuthContext, id: string) {
    this.admin(auth);
    const hook = await this.db.selectFrom('webhooks').selectAll().where('id', '=', id).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    if (!hook) throw new NotFoundException();
    return hook;
  }

  private async clean(auth: AuthContext, input: WebhookInput, partial: boolean) {
    const out: { name?: string; url?: string; kind?: WebhookKind; project_id?: string | null; events?: WebhookEvent[]; active?: boolean } = {};
    if (!partial || input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 80) throw new BadRequestException('Donnez un nom à l’intégration (80 caractères au plus).');
      out.name = name;
    }
    if (!partial || input.url !== undefined) {
      const url = typeof input.url === 'string' ? input.url.trim() : '';
      const problem = webhookUrlProblem(url);
      if (problem) throw new BadRequestException(problem);
      out.url = url;
    }
    if (!partial || input.kind !== undefined) {
      if (!KINDS.includes(input.kind as WebhookKind)) throw new BadRequestException('Type: generic, slack (Slack ou Mattermost) ou teams.');
      out.kind = input.kind as WebhookKind;
    }
    if (!partial || input.events !== undefined) {
      const events = Array.isArray(input.events) ? [...new Set(input.events)] : [];
      if (events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e as WebhookEvent))) throw new BadRequestException(`Choisissez au moins un événement parmi ${WEBHOOK_EVENTS.join(', ')}.`);
      out.events = events as WebhookEvent[];
    }
    if (input.projectId !== undefined) {
      if (input.projectId === null || input.projectId === '') out.project_id = null;
      else {
        const project = await this.db.selectFrom('projects').select('id').where('id', '=', String(input.projectId)).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
        if (!project) throw new BadRequestException('Volume inconnu.');
        out.project_id = project.id;
      }
    }
    if (input.active !== undefined) out.active = input.active === true;
    return out;
  }

  async list(auth: AuthContext) {
    this.admin(auth);
    const hooks = await this.db
      .selectFrom('webhooks as w')
      .leftJoin('projects as p', 'p.id', 'w.project_id')
      .select(['w.id', 'w.name', 'w.url', 'w.kind', 'w.events', 'w.active', 'w.secret', 'w.created_at', 'p.id as project_id', 'p.name as project_name'])
      .where('w.workspace_id', '=', auth.user.workspace_id)
      .orderBy('w.created_at')
      .execute();
    const last = hooks.length
      ? await this.db
          .selectFrom('webhook_deliveries')
          .distinctOn('webhook_id')
          .select(['webhook_id', 'status', 'error', 'created_at'])
          .where('webhook_id', 'in', hooks.map((h) => h.id))
          .orderBy('webhook_id')
          .orderBy('created_at', 'desc')
          .execute()
      : [];
    const byHook = new Map(last.map((d) => [d.webhook_id, d]));
    return {
      events: WEBHOOK_EVENTS,
      webhooks: hooks.map((h) => {
        const d = byHook.get(h.id);
        return {
          id: h.id,
          name: h.name,
          url: h.url,
          kind: h.kind,
          events: h.events,
          active: h.active,
          secret: h.kind === 'generic' ? h.secret : null,
          project: h.project_id ? { id: h.project_id, name: h.project_name } : null,
          createdAt: h.created_at.toISOString(),
          lastDelivery: d ? { status: d.status, error: d.error, at: d.created_at.toISOString() } : null,
        };
      }),
    };
  }

  async create(auth: AuthContext, input: WebhookInput, ip: string) {
    this.admin(auth);
    const values = await this.clean(auth, input, false);
    const row = await this.db
      .insertInto('webhooks')
      .values({ workspace_id: auth.user.workspace_id, project_id: values.project_id ?? null, name: values.name!, url: values.url!, kind: values.kind!, events: values.events!, secret: newWebhookSecret(), created_by: auth.user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'webhook.created', targetType: 'webhook', targetId: row.id, ip, metadata: { name: values.name, host: new URL(values.url!).host, kind: values.kind, events: values.events } });
    return { id: row.id };
  }

  async update(auth: AuthContext, id: string, input: WebhookInput, ip: string) {
    const hook = await this.owned(auth, id);
    const values = await this.clean(auth, input, true);
    if (Object.keys(values).length === 0) return;
    await this.db.updateTable('webhooks').set(values).where('id', '=', hook.id).execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'webhook.updated', targetType: 'webhook', targetId: hook.id, ip, metadata: { ...values, url: values.url ? new URL(values.url).host : undefined } });
  }

  async remove(auth: AuthContext, id: string, ip: string) {
    const hook = await this.owned(auth, id);
    await this.db.deleteFrom('webhooks').where('id', '=', hook.id).execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'webhook.deleted', targetType: 'webhook', targetId: hook.id, ip, metadata: { name: hook.name } });
  }

  /** Nouvelle clé de signature: l'ancienne cesse aussitôt de valoir. */
  async rotate(auth: AuthContext, id: string, ip: string) {
    const hook = await this.owned(auth, id);
    const secret = newWebhookSecret();
    await this.db.updateTable('webhooks').set({ secret }).where('id', '=', hook.id).execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'webhook.secret_rotated', targetType: 'webhook', targetId: hook.id, ip, metadata: {} });
    return { secret };
  }

  /** Envoie un « ping » tout de suite, et dit ce que le destinataire a répondu. */
  async test(auth: AuthContext, id: string) {
    const hook = await this.owned(auth, id);
    const payload = pingPayload();
    const { body, headers } = webhookRequest(hook.kind, hook.secret, payload);
    const result = await deliverWebhook(hook.url, body, headers, { allowPrivate: config.webhookAllowPrivate });
    await this.db.insertInto('webhook_deliveries').values({ webhook_id: hook.id, event: 'ping', attempt: 1, status: result.status, error: result.error, duration_ms: result.durationMs }).execute();
    return { status: result.status, error: result.error, durationMs: result.durationMs };
  }

  async deliveries(auth: AuthContext, id: string) {
    const hook = await this.owned(auth, id);
    const rows = await this.db.selectFrom('webhook_deliveries').selectAll().where('webhook_id', '=', hook.id).orderBy('created_at', 'desc').limit(30).execute();
    return rows.map((d) => ({ id: d.id, event: d.event, attempt: d.attempt, status: d.status, error: d.error, durationMs: d.duration_ms, at: d.created_at.toISOString() }));
  }
}
