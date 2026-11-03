import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { newApiToken, type Database, type TokenScope } from '@andal/db';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import type { AuthContext } from '../auth/auth.guard.js';
import { DB } from '../infra.module.js';

/** Au-delà, mieux vaut faire le ménage: un jeton oublié est une porte ouverte. */
const MAX_ACTIVE = 20;
const DURATIONS = [7, 30, 90, 365];

/**
 * Jetons d'API personnels. Un jeton agit au nom de son auteur, avec ses droits
 * du moment (un volume qu'il ne lit plus, le jeton ne le lit plus), en lecture
 * seule ou en écriture. Il n'est montré qu'une fois; seule son empreinte reste.
 */
@Injectable()
export class TokensService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext) {
    const rows = await this.db.selectFrom('api_tokens').selectAll().where('user_id', '=', auth.user.id).where('revoked_at', 'is', null).orderBy('created_at', 'desc').execute();
    const now = new Date();
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scope: t.scope,
      createdAt: t.created_at.toISOString(),
      expiresAt: t.expires_at?.toISOString() ?? null,
      expired: t.expires_at !== null && t.expires_at < now,
      lastUsedAt: t.last_used_at?.toISOString() ?? null,
    }));
  }

  async create(auth: AuthContext, input: { name?: unknown; scope?: unknown; expiresInDays?: unknown }, ip: string) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 60) throw new BadRequestException('Donnez un nom au jeton (60 caractères au plus): « CI specs », « Script d’export »…');
    if (input.scope !== 'read' && input.scope !== 'write') throw new BadRequestException('Portée: « read » (lecture) ou « write » (lecture et écriture).');
    const scope: TokenScope = input.scope;
    let expiresAt: Date | null = null;
    if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
      const days = Number(input.expiresInDays);
      if (!DURATIONS.includes(days)) throw new BadRequestException(`Durée: ${DURATIONS.join(', ')} jours, ou sans expiration.`);
      expiresAt = new Date(Date.now() + days * 86_400_000);
    }
    const active = await this.db.selectFrom('api_tokens').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', auth.user.id).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(active.n) >= MAX_ACTIVE) throw new ForbiddenException(`${MAX_ACTIVE} jetons actifs au plus: révoquez ceux qui ne servent plus.`);

    const { token, hash, prefix } = newApiToken();
    const row = await this.db.insertInto('api_tokens').values({ user_id: auth.user.id, name, token_hash: hash, prefix, scope, expires_at: expiresAt }).returning(['id', 'created_at']).executeTakeFirstOrThrow();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'token.created', targetType: 'api_token', targetId: row.id, ip, metadata: { name, scope, expiresAt: expiresAt?.toISOString() ?? null } });
    return { id: row.id, name, prefix, scope, createdAt: row.created_at.toISOString(), expiresAt: expiresAt?.toISOString() ?? null, expired: false, lastUsedAt: null, token };
  }

  async revoke(auth: AuthContext, id: string, ip: string) {
    const result = await this.db.updateTable('api_tokens').set({ revoked_at: new Date() }).where('id', '=', id).where('user_id', '=', auth.user.id).where('revoked_at', 'is', null).executeTakeFirst();
    if (!result.numUpdatedRows) throw new NotFoundException();
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'token.revoked', targetType: 'api_token', targetId: id, ip, metadata: {} });
  }
}
