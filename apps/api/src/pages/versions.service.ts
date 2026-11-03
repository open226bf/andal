import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { can, type Subject } from '@andal/authz';
import { recordVersion, type Database } from '@andal/db';
import type { JSONContent } from '@andal/editor';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { DocsService } from '../docs/docs.service.js';
import { DB } from '../infra.module.js';

const HISTORY_SIZE = 100;

/**
 * Historique d'une page: qui peut la lire voit ses versions; qui peut
 * l'écrire en restaure une. La restauration passe par le serveur collab, pour
 * que les pages ouvertes la reçoivent, et devient elle-même une version.
 */
@Injectable()
export class VersionsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly docs: DocsService,
    private readonly bridge: CollabBridgeService,
    private readonly audit: AuditService,
  ) {}

  private async authors(ids: string[]) {
    const users = ids.length ? await this.db.selectFrom('users').select(['id', 'name', 'initials', 'color']).where('id', 'in', ids).execute() : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  async list(subject: Subject, pageId: string) {
    await this.docs.require(subject, pageId, 'page.read');
    const [page, rows] = await Promise.all([
      this.db.selectFrom('pages').select('version').where('id', '=', pageId).executeTakeFirstOrThrow(),
      this.db.selectFrom('page_versions').select(['id', 'version', 'title', 'authors', 'created_at', 'updated_at']).where('page_id', '=', pageId).orderBy('version', 'desc').limit(HISTORY_SIZE).execute(),
    ]);
    const people = await this.authors([...new Set(rows.flatMap((r) => r.authors))]);
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      title: r.title,
      current: r.version === page.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      authors: r.authors.map((id) => people.get(id)).filter((u) => u !== undefined),
    }));
  }

  async get(subject: Subject, pageId: string, version: number) {
    await this.docs.require(subject, pageId, 'page.read');
    const row = await this.db.selectFrom('page_versions').select(['id', 'version', 'title', 'content', 'authors', 'updated_at']).where('page_id', '=', pageId).where('version', '=', version).executeTakeFirst();
    if (!row) throw new NotFoundException();
    const people = await this.authors(row.authors);
    return {
      id: row.id,
      version: row.version,
      title: row.title,
      content: row.content as JSONContent,
      updatedAt: row.updated_at.toISOString(),
      authors: row.authors.map((id) => people.get(id)).filter((u) => u !== undefined),
    };
  }

  async restore(auth: AuthContext, pageId: string, version: number, ip: string) {
    const access = await this.docs.require(auth.subject, pageId, 'page.read');
    if (!can(access.role, 'page.edit')) throw new ForbiddenException('Il faut le droit d’écriture sur la page pour restaurer une version.');
    const [page, target] = await Promise.all([
      this.db.selectFrom('pages').select(['version', 'title']).where('id', '=', pageId).executeTakeFirstOrThrow(),
      this.db.selectFrom('page_versions').select(['id', 'version', 'title']).where('page_id', '=', pageId).where('version', '=', version).executeTakeFirst(),
    ]);
    if (!target) throw new NotFoundException();
    if (target.version === page.version) throw new ConflictException('C’est déjà la version actuelle.');

    const titleChanged = target.title !== page.title;
    if (titleChanged) await this.db.updateTable('pages').set({ title: target.title, updated_by: auth.user.id, updated_at: new Date() }).where('id', '=', pageId).execute();
    const reply = await this.bridge.restore(pageId, target.id, auth.user.id);
    if (reply === 'timeout') throw new ServiceUnavailableException('Le serveur de collaboration ne répond pas. Réessayez dans un instant.');
    if (reply === 'invalid' || reply === 'error') throw new UnprocessableEntityException('Cette version ne peut pas être restaurée.');
    if (reply === 'same') {
      if (!titleChanged) throw new ConflictException('Le contenu de cette version est celui de la page actuelle.');
      // Seul le titre change: le serveur collab n'a rien enregistré, la version s'ouvre ici.
      await recordVersion(this.db, pageId, auth.user.id, { fresh: true });
    }
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'page.version_restored', targetType: 'page', targetId: pageId, ip, metadata: { version } });
    if (titleChanged) await this.bridge.treeChanged();
    const after = await this.db.selectFrom('pages').select('version').where('id', '=', pageId).executeTakeFirstOrThrow();
    return { version: after.version };
  }
}
