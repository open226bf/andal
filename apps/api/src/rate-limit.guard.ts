import { createHash } from 'node:crypto';
import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { config } from './env.js';
import { VALKEY } from './infra.module.js';

const WINDOW_SECONDS = 60;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Limite de débit de toute l'API, après l'authentification: par session ou
 * par jeton d'API pour qui est connu, par adresse IP sinon. Fenêtres d'une
 * minute dans Valkey, partagées par toutes les instances de l'API. Les
 * écritures ont leur propre plafond, plus bas que les lectures.
 *
 * En-têtes RateLimit-Limit / -Remaining / -Reset sur chaque réponse; au-delà,
 * 429 avec Retry-After. La connexion, la double authentification et l'assistant
 * gardent en plus leurs freins propres.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limits = config.rateLimit;
    if (!limits) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    // La sonde de santé passe toujours: Docker et l'orchestrateur l'appellent sans relâche.
    if (request.url.startsWith('/api/health')) return true;

    const auth = request.auth;
    const write = WRITES.has(request.method);
    // SCIM passe sans session: le fournisseur d'identité est compté par son jeton, au plafond d'un compte connecté.
    const scim = request.url.startsWith('/api/scim/') && request.headers.authorization ? createHash('sha256').update(request.headers.authorization).digest('hex').slice(0, 32) : null;
    const who = auth?.token ? `token:${auth.token.id}` : auth ? `user:${auth.user.id}` : scim ? `scim:${scim}` : `ip:${request.ip}`;
    const limit = !auth && !scim ? limits.anonymous : write ? limits.writes : limits.reads;
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `andal:rl:${who}:${write ? 'w' : 'r'}:${window}`;

    const result = await this.valkey.multi().incr(key).expire(key, WINDOW_SECONDS + 5).exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    const reset = WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % WINDOW_SECONDS);
    void reply.header('RateLimit-Limit', String(limit));
    void reply.header('RateLimit-Remaining', String(Math.max(0, limit - count)));
    void reply.header('RateLimit-Reset', String(reset));
    if (count > limit) {
      void reply.header('Retry-After', String(reset));
      throw new HttpException(`Trop de requêtes: au plus ${limit} ${write ? 'écritures' : 'requêtes'} par minute. Réessayez dans ${reset} s.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
