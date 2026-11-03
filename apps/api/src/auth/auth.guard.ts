import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Subject } from '@andal/authz';
import { loadSubject, SESSION_COOKIE, sessionKey, sessionStillValid, type Database, type SessionData, type User } from '@andal/db';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { DB, VALKEY } from '../infra.module.js';

export interface AuthContext {
  sessionId: string;
  session: SessionData;
  user: User;
  subject: Subject;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const PUBLIC = 'andal:public';

/** Route accessible sans session (santé, connexion). Tout le reste est fermé par défaut. */
export const Public = () => SetMetadata(PUBLIC, true);

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
}
