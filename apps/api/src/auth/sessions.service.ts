import { Inject, Injectable } from '@nestjs/common';
import { newSessionId, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionKey, type Database, type SessionData, type User } from '@andal/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { config } from '../env.js';
import { DB, VALKEY } from '../infra.module.js';

/** Ouverture et fermeture des sessions, quel que soit le mode de connexion. */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  async open(user: User, method: SessionData['method'], req: FastifyRequest, reply: FastifyReply, extra: { idToken?: string; createdAt?: Date } = {}) {
    // Une session déjà présente dans le navigateur est fermée: pas de fixation de session.
    const previous = req.cookies[SESSION_COOKIE];
    if (previous) await this.valkey.del(sessionKey(previous));

    const sessionId = newSessionId();
    const data: SessionData = { userId: user.id, createdAt: (extra.createdAt ?? new Date()).toISOString(), method, ...(extra.idToken ? { idToken: extra.idToken } : {}) };
    await this.valkey.set(sessionKey(sessionId), JSON.stringify(data), 'EX', SESSION_TTL_SECONDS);
    reply.setCookie(SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: SESSION_TTL_SECONDS,
    });
    await this.db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();
    await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip: req.ip, metadata: { method } });
  }

  async close(sessionId: string, reply: FastifyReply) {
    await this.valkey.del(sessionKey(sessionId));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
