import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Subject } from '@andal/authz';
import { API_TOKEN_PREFIX, linkTokenHash, loadSubject, SESSION_COOKIE, sessionKey, sessionStillValid, type Database, type SessionData, type TokenScope, type User } from '@andal/db';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { DB, VALKEY } from '../infra.module.js';

export interface AuthContext {
  /** Vide pour une requête faite avec un jeton d'API. */
  sessionId: string;
  session: SessionData;
  user: User;
  subject: Subject;
  /** Le jeton d'API de la requête, s'il y en a un. */
  token?: { id: string; scope: TokenScope };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const PUBLIC = 'andal:public';
const SESSION_ONLY = 'andal:session-only';

/** Route accessible sans session (santé, connexion). Tout le reste est fermé par défaut. */
export const Public = () => SetMetadata(PUBLIC, true);

/**
 * Route réservée à une session de navigateur: un jeton d'API n'y entre pas
 * (comptes, groupes, partage, jetons eux-mêmes, intégrations).
 */
export const SessionOnly = () => SetMetadata(SESSION_ONLY, true);

/** Dernière utilisation d'un jeton: notée au plus une fois par minute. */
const TOKEN_TOUCH_MS = 60_000;

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!request.auth) throw new UnauthorizedException();
  return request.auth;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (bearer) {
      const sessionOnly = this.reflector.getAllAndOverride<boolean>(SESSION_ONLY, [context.getHandler(), context.getClass()]);
      request.auth = await this.tokenAuth(bearer, request, sessionOnly);
      return true;
    }

    const sessionId = request.cookies[SESSION_COOKIE];
    if (!sessionId) throw new UnauthorizedException('Session absente');

    const raw = await this.valkey.get(sessionKey(sessionId));
    if (!raw) throw new UnauthorizedException('Session expirée');
    const session = JSON.parse(raw) as SessionData;

    const loaded = await loadSubject(this.db, session.userId);
    if (!loaded || !sessionStillValid(session, loaded.user)) {
      await this.valkey.del(sessionKey(sessionId));
      throw new UnauthorizedException('Session révoquée');
    }

    request.auth = { sessionId, session, user: loaded.user, subject: loaded.subject };
    return true;
  }

  /** Requête signée d'un jeton d'API: les droits de son auteur, en lecture seule si sa portée le dit. */
  private async tokenAuth(token: string, request: FastifyRequest, sessionOnly: boolean): Promise<AuthContext> {
    if (!token.startsWith(API_TOKEN_PREFIX)) throw new UnauthorizedException('Jeton invalide');
    const row = await this.db.selectFrom('api_tokens').selectAll().where('token_hash', '=', linkTokenHash(token)).executeTakeFirst();
    if (!row || row.revoked_at || (row.expires_at && row.expires_at < new Date())) throw new UnauthorizedException('Jeton invalide, expiré ou révoqué');
    const loaded = await loadSubject(this.db, row.user_id);
    if (!loaded || loaded.user.disabled_at) throw new UnauthorizedException('Compte désactivé');
    if (sessionOnly) throw new ForbiddenException('Cette route demande une session de navigateur, pas un jeton d’API.');
    if (row.scope === 'read' && !['GET', 'HEAD'].includes(request.method)) throw new ForbiddenException('Ce jeton est en lecture seule.');
    if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > TOKEN_TOUCH_MS) {
      await this.db.updateTable('api_tokens').set({ last_used_at: new Date(), last_used_ip: request.ip }).where('id', '=', row.id).execute();
    }
    return {
      sessionId: '',
      session: { userId: row.user_id, createdAt: row.created_at.toISOString(), method: 'token' },
      user: loaded.user,
      subject: loaded.subject,
      token: { id: row.id, scope: row.scope },
    };
  }
}
