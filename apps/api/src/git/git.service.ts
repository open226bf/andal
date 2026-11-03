import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { can } from '@andal/authz';
import { projectRoleFor, type Database } from '@andal/db';
import type { Queue } from 'bullmq';
import type { Kysely } from 'kysely';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { config } from '../env.js';
import { DB, QUEUE } from '../infra.module.js';

interface GitInput {
  repoUrl?: unknown;
  branch?: unknown;
  path?: unknown;
  token?: unknown;
  enabled?: unknown;
}

/** Adresse de la page du fichier dans la forge (GitHub, GitLab, Gitea, Forgejo). */
export function forgeUrl(repoUrl: string, branch: string, root: string, key: string): string | null {
  if (!repoUrl.startsWith('https://')) return null;
  const base = repoUrl.replace(/\.git$/, '').replace(/\/+$/, '');
  const full = [root.replace(/^\/+|\/+$/g, ''), key].filter(Boolean).join('/');
  const separator = base.includes('gitlab') ? '/-' : '';
  return `${base}${separator}/${/\.(md|markdown)$/i.test(key) ? 'blob' : 'tree'}/${encodeURIComponent(branch)}/${full.split('/').map(encodeURIComponent).join('/')}`;
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Synchro Git d'un volume (docs-as-code): un dossier d'un dépôt devient une
 * branche du sommaire, tenue par le dépôt. Réglée par les admins du volume.
 */
@Injectable()
export class GitService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly audit: AuditService,
  ) {}

  private async managed(auth: AuthContext, projectId: string) {
    const project = await this.db.selectFrom('projects').select(['id', 'archived_at']).where('id', '=', projectId).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    const role = project ? await projectRoleFor(this.db, auth.subject, project.id) : null;
    if (!project || !role) throw new NotFoundException();
    if (!can(role, 'project.manage')) throw new ForbiddenException('Réservé aux admins du volume.');
    return project;
  }

  private enqueue(syncId: string, force: boolean) {
    // Un seul passage à la fois par volume: une demande pendant un passage attend le suivant.
    return this.queue.add('git.sync', { syncId, force }, { jobId: `git-sync-${syncId}${force ? '-force' : ''}`, removeOnComplete: true, removeOnFail: 50 });
  }

  async get(auth: AuthContext, projectId: string) {
    await this.managed(auth, projectId);
    const sync = await this.db.selectFrom('git_syncs').selectAll().where('project_id', '=', projectId).executeTakeFirst();
    if (!sync) return { configured: false as const };
    const pages = await this.db.selectFrom('pages').select((eb) => eb.fn.countAll<number>().as('n')).where('git_sync_id', '=', sync.id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    return {
      configured: true as const,
      repoUrl: sync.repo_url,
      branch: sync.branch,
      path: sync.path,
      hasToken: sync.access_token !== null,
      enabled: sync.enabled,
      lastCommit: sync.last_commit,
      lastSyncedAt: sync.last_synced_at?.toISOString() ?? null,
      lastError: sync.last_error,
      pageCount: Number(pages.n),
      webhookUrl: `${config.webOrigin}/api/git/hooks/${sync.id}`,
      webhookSecret: sync.webhook_secret,
    };
  }

  async save(auth: AuthContext, projectId: string, input: GitInput, ip: string) {
    const project = await this.managed(auth, projectId);
    if (project.archived_at) throw new ForbiddenException('Volume archivé: lecture seule.');
    const repoUrl = typeof input.repoUrl === 'string' ? input.repoUrl.trim() : '';
    const local = config.gitAllowLocal && repoUrl.startsWith('file://');
    let parsed: URL | null = null;
    try {
      parsed = new URL(repoUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'https:' && !local)) throw new BadRequestException('Adresse du dépôt en https:// (par exemple https://github.com/equipe/docs.git).');
    if (parsed.username || parsed.password) throw new BadRequestException('Pas d’identifiants dans l’adresse: utilisez le jeton d’accès.');
    const branch = typeof input.branch === 'string' && input.branch.trim() ? input.branch.trim() : 'main';
    if (!/^[\w./-]{1,100}$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new BadRequestException('Nom de branche invalide.');
    const path = typeof input.path === 'string' ? input.path.trim().replace(/^\/+|\/+$/g, '') : '';
    if (path.split('/').some((part) => part === '..') || path.length > 200) throw new BadRequestException('Dossier invalide.');
    const token = input.token === null ? null : typeof input.token === 'string' && input.token.trim() ? input.token.trim() : undefined;

    const existing = await this.db.selectFrom('git_syncs').select('id').where('project_id', '=', projectId).executeTakeFirst();
    let id: string;
    if (existing) {
      id = existing.id;
      await this.db
        .updateTable('git_syncs')
        .set({ repo_url: repoUrl, branch, path, ...(token !== undefined ? { access_token: token } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled === true } : {}), last_commit: null, last_error: null })
        .where('id', '=', id)
        .execute();
    } else {
      const row = await this.db
        .insertInto('git_syncs')
        .values({ project_id: projectId, repo_url: repoUrl, branch, path, access_token: token ?? null, webhook_secret: randomBytes(24).toString('base64url'), created_by: auth.user.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      id = row.id;
    }
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: existing ? 'git.updated' : 'git.created', targetType: 'project', targetId: projectId, ip, metadata: { repo: parsed.host + parsed.pathname, branch, path } });
    await this.enqueue(id, true);
    return this.get(auth, projectId);
  }

  async remove(auth: AuthContext, projectId: string, ip: string) {
    await this.managed(auth, projectId);
    const sync = await this.db.selectFrom('git_syncs').select('id').where('project_id', '=', projectId).executeTakeFirst();
    if (!sync) throw new NotFoundException();
    // Les pages restent, et redeviennent modifiables dans Andal (git_sync_id passe à null).
    await this.db.deleteFrom('git_syncs').where('id', '=', sync.id).execute();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'git.deleted', targetType: 'project', targetId: projectId, ip, metadata: {} });
  }

  async syncNow(auth: AuthContext, projectId: string) {
    await this.managed(auth, projectId);
    const sync = await this.db.selectFrom('git_syncs').select('id').where('project_id', '=', projectId).executeTakeFirst();
    if (!sync) throw new NotFoundException();
    await this.enqueue(sync.id, true);
  }

  /**
   * Webhook « push » de la forge: GitHub et Gitea signent le corps
   * (X-Hub-Signature-256, X-Gitea-Signature), GitLab envoie le secret (X-Gitlab-Token).
   */
  async hook(syncId: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined) {
    const sync = await this.db.selectFrom('git_syncs').select(['id', 'webhook_secret', 'enabled']).where('id', '=', syncId).executeTakeFirst();
    if (!sync) throw new NotFoundException();
    const header = (name: string) => {
      const value = headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const body = rawBody ?? Buffer.alloc(0);
    const digest = createHmac('sha256', sync.webhook_secret).update(body).digest('hex');
    const github = header('x-hub-signature-256');
    const gitea = header('x-gitea-signature') ?? header('x-forgejo-signature');
    const gitlab = header('x-gitlab-token');
    const valid = (github && safeEqual(github, `sha256=${digest}`)) || (gitea && safeEqual(gitea, digest)) || (gitlab && safeEqual(gitlab, sync.webhook_secret));
    if (!valid) throw new UnauthorizedException('Signature invalide.');
    if (header('x-github-event') === 'ping') return { queued: false };
    if (sync.enabled) await this.enqueue(sync.id, false);
    return { queued: sync.enabled };
  }
}
