import { BadRequestException, Controller, ForbiddenException, Get, Headers, Inject, Query, Res } from '@nestjs/common';
import { canManageAccounts } from '@andal/authz';
import { localeFromHeader, tr, type Database } from '@andal/db';
import type { FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import { type AuthContext, CurrentAuth, SessionOnly } from '../auth/auth.guard.js';
import { DB } from '../infra.module.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;
const EXPORT_MAX = 50_000;

interface Filters {
  action?: string;
  actor?: string;
  target?: string;
  from?: string;
  to?: string;
  before?: string;
}

interface Row {
  id: string;
  created_at: Date;
  action: string;
  actor_id: string | null;
  target_type: string;
  target_id: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  actor_name: string | null;
  actor_email: string | null;
  actor_initials: string | null;
  actor_color: string | null;
}

function day(value: string | undefined, field: string, end: boolean): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field}: une date AAAA-MM-JJ.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field}: date invalide.`);
  // « jusqu'au 12 »: le 12 compris.
  return end ? new Date(date.getTime() + 24 * 60 * 60 * 1000) : date;
}

/** Une cellule CSV sûre: guillemets doublés, et pas de formule pour un tableur (=, +, -, @). */
function cell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Le journal d'audit de l'espace, pour ses admins: filtres par action ou
 * famille d'actions (« auth. »), par personne, par cible et par dates; pages
 * de 50 du plus récent au plus ancien (curseur `before`), et export CSV.
 */
@SessionOnly()
@Controller('admin/audit')
export class AuditController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  private assertAdmin(auth: AuthContext) {
    if (!canManageAccounts(auth.user.workspace_role)) throw new ForbiddenException("Réservé aux admins de l'espace.");
  }

  private query(workspaceId: string, filters: Filters) {
    let query = this.db
      .selectFrom('audit_events as e')
      .leftJoin('users as u', 'u.id', 'e.actor_id')
      .select(['e.id', 'e.created_at', 'e.action', 'e.actor_id', 'e.target_type', 'e.target_id', 'e.ip', 'e.metadata', 'u.name as actor_name', 'u.email as actor_email', 'u.initials as actor_initials', 'u.color as actor_color'])
      .where('e.workspace_id', '=', workspaceId);
    if (filters.action) {
      if (!/^[a-z_]+(\.[a-z_]*)?$/.test(filters.action) || filters.action.length > 60) throw new BadRequestException('action: « auth.login » ou une famille, « auth. ».');
      query = filters.action.endsWith('.') ? query.where('e.action', 'like', `${filters.action}%`) : query.where('e.action', '=', filters.action);
    }
    if (filters.actor) {
      if (!UUID.test(filters.actor)) throw new BadRequestException('actor: identifiant de compte invalide.');
      query = query.where('e.actor_id', '=', filters.actor);
    }
    if (filters.target) {
      if (!UUID.test(filters.target)) throw new BadRequestException('target: identifiant invalide.');
      query = query.where('e.target_id', '=', filters.target);
    }
    const from = day(filters.from, 'from', false);
    const to = day(filters.to, 'to', true);
    if (from) query = query.where('e.created_at', '>=', from);
    if (to) query = query.where('e.created_at', '<', to);
    if (filters.before) {
      // Curseur: le numéro du dernier événement vu. Les numéros suivent l'ordre d'écriture.
      if (!/^\d{1,19}$/.test(filters.before)) throw new BadRequestException('before: curseur invalide.');
      query = query.where('e.id', '<', filters.before);
    }
    return query.orderBy('e.id', 'desc');
  }

  /** Un nom lisible pour chaque cible, même supprimée depuis (le journal garde son nom dans les détails). */
  private async targets(workspaceId: string, rows: Row[]) {
    const ids = (type: string) => [...new Set(rows.filter((r) => r.target_type === type && r.target_id).map((r) => r.target_id!))];
    const lookup = async <T extends { id: string }>(type: string, load: (list: string[]) => Promise<T[]>) => {
      const list = ids(type);
      return new Map((list.length ? await load(list) : []).map((r) => [r.id, r]));
    };
    const [users, pages, projects, groups, specs, tokens, webhooks, rayons, attachments, workspace] = await Promise.all([
      lookup('user', (l) => this.db.selectFrom('users').select(['id', 'name']).where('id', 'in', l).execute()),
      lookup('page', (l) =>
        this.db.selectFrom('pages as p').innerJoin('projects as pr', 'pr.id', 'p.project_id').select(['p.id', 'p.title', 'p.deleted_at', 'pr.short_name']).where('p.id', 'in', l).where('pr.workspace_id', '=', workspaceId).execute(),
      ),
      lookup('project', (l) => this.db.selectFrom('projects').select(['id', 'name', 'slug']).where('id', 'in', l).where('workspace_id', '=', workspaceId).execute()),
      lookup('group', (l) => this.db.selectFrom('groups').select(['id', 'name']).where('id', 'in', l).execute()),
      lookup('api_spec', (l) => this.db.selectFrom('api_specs').select(['id', 'name']).where('id', 'in', l).execute()),
      lookup('api_token', (l) => this.db.selectFrom('api_tokens').select(['id', 'name']).where('id', 'in', l).execute()),
      lookup('webhook', (l) => this.db.selectFrom('webhooks').select(['id', 'name']).where('id', 'in', l).execute()),
      lookup('rayon', (l) => this.db.selectFrom('rayons').select(['id', 'name']).where('id', 'in', l).execute()),
      lookup('attachment', (l) => this.db.selectFrom('attachments').select(['id', 'name']).where('id', 'in', l).execute()),
      this.db.selectFrom('workspaces').select('name').where('id', '=', workspaceId).executeTakeFirst(),
    ]);
    return (row: Row): { label: string | null; href: string | null } => {
      const id = row.target_id ?? '';
      const meta = row.metadata ?? {};
      const fallback = [meta.name, meta.title, meta.email, typeof meta.from === 'string' ? meta.from : null].find((v): v is string => typeof v === 'string') ?? null;
      switch (row.target_type) {
        case 'user':
          return { label: users.get(id)?.name ?? fallback, href: null };
        case 'page': {
          const page = pages.get(id);
          return page ? { label: `${page.title} (${page.short_name})`, href: page.deleted_at ? null : `/p/${id}` } : { label: fallback, href: null };
        }
        case 'project': {
          const project = projects.get(id);
          return project ? { label: project.name, href: `/v/${project.slug}` } : { label: fallback, href: null };
        }
        case 'group':
          return { label: groups.get(id)?.name ?? fallback, href: null };
        case 'api_spec':
          return specs.has(id) ? { label: specs.get(id)!.name, href: `/specs/${id}` } : { label: fallback, href: null };
        case 'api_token':
          return { label: tokens.get(id)?.name ?? fallback, href: null };
        case 'webhook':
          return { label: webhooks.get(id)?.name ?? fallback, href: null };
        case 'rayon':
          return { label: rayons.get(id)?.name ?? fallback, href: null };
        case 'attachment':
          return { label: attachments.get(id)?.name ?? fallback, href: null };
        case 'workspace':
          return { label: workspace?.name ?? null, href: null };
        default:
          return { label: fallback, href: null };
      }
    };
  }

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query() filters: Filters & { limit?: string }, @Headers('accept-language') language?: string) {
    this.assertAdmin(auth);
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || PAGE_SIZE));
    const rows = (await this.query(auth.user.workspace_id, filters)
      .limit(limit + 1)
      .execute()) as Row[];
    const page = rows.slice(0, limit);
    const label = await this.targets(auth.user.workspace_id, page);
    const [people, actions] = await Promise.all([
      // Pour les filtres: les comptes de l'espace, et les actions déjà vues.
      this.db.selectFrom('users').select(['id', 'name']).where('workspace_id', '=', auth.user.workspace_id).orderBy('name').execute(),
      filters.before ? Promise.resolve(null) : this.db.selectFrom('audit_events').select('action').distinct().where('workspace_id', '=', auth.user.workspace_id).orderBy('action').execute(),
    ]);
    const last = page[page.length - 1];
    return {
      events: page.map((r) => ({
        id: r.id,
        at: r.created_at.toISOString(),
        action: r.action,
        actor: r.actor_id ? { id: r.actor_id, name: r.actor_name ?? tr(localeFromHeader(language), 'Compte supprimé'), initials: r.actor_initials ?? '?', color: r.actor_color ?? 'ink' } : null,
        target: { type: r.target_type, id: r.target_id, ...label(r) },
        ip: r.ip,
        metadata: r.metadata,
      })),
      next: rows.length > limit && last ? String(last.id) : null,
      people,
      actions: actions?.map((a) => a.action) ?? null,
    };
  }

  @Get('export')
  async export(@CurrentAuth() auth: AuthContext, @Query() filters: Filters, @Res({ passthrough: true }) reply: FastifyReply) {
    this.assertAdmin(auth);
    const rows = (await this.query(auth.user.workspace_id, { ...filters, before: undefined })
      .limit(EXPORT_MAX)
      .execute()) as Row[];
    const label = await this.targets(auth.user.workspace_id, rows);
    const lines = [['date', 'action', 'personne', 'email', 'cible_type', 'cible_id', 'cible', 'ip', 'details'].join(',')];
    for (const r of rows) {
      lines.push([r.created_at.toISOString(), r.action, r.actor_name ?? '', r.actor_email ?? '', r.target_type, r.target_id ?? '', label(r).label ?? '', r.ip ?? '', JSON.stringify(r.metadata ?? {})].map(cell).join(','));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="andal-audit-${stamp}.csv"`);
    reply.header('Cache-Control', 'no-store');
    // BOM: Excel lit l'UTF-8 sans écorcher les accents.
    return `﻿${lines.join('\r\n')}\r\n`;
  }
}
