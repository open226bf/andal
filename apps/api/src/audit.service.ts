import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@andal/db';
import type { Kysely } from 'kysely';
import { DB } from './infra.module.js';

export interface AuditEntry {
  workspaceId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

/** Journal d'audit en ajout seul (un trigger PostgreSQL refuse toute modification). */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db
      .insertInto('audit_events')
      .values({
        workspace_id: entry.workspaceId,
        actor_id: entry.actorId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId ?? null,
        ip: entry.ip ?? null,
        metadata: JSON.stringify(entry.metadata ?? {}),
      })
      .execute();
  }
}
