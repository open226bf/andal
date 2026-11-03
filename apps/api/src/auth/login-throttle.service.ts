import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { VALKEY } from '../infra.module.js';

const WINDOW_SECONDS = 15 * 60;
/** Échecs tolérés par compte visé, puis par adresse IP, sur la fenêtre. */
const MAX_PER_ACCOUNT = 8;
const MAX_PER_IP = 40;

/**
 * Freine la recherche de mot de passe par force brute: au-delà du seuil,
 * les tentatives sont refusées jusqu'à la fin de la fenêtre, même justes.
 */
@Injectable()
export class LoginThrottleService {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  private keys(account: string, ip: string): [string, string] {
    const hashed = createHash('sha256').update(account.trim().toLowerCase()).digest('hex');
    return [`login:account:${hashed}`, `login:ip:${ip}`];
  }

  /** Lève une erreur 429 avec Retry-After si le compte ou l'adresse a trop échoué. */
  async guard(account: string, ip: string, reply: FastifyReply): Promise<void> {
    const [accountKey, ipKey] = this.keys(account, ip);
    const [accountFailures, ipFailures] = await this.valkey.mget(accountKey, ipKey);
    const blocked = Number(accountFailures) >= MAX_PER_ACCOUNT ? accountKey : Number(ipFailures) >= MAX_PER_IP ? ipKey : null;
    if (!blocked) return;
    const wait = Math.max(1, await this.valkey.ttl(blocked));
    reply.header('Retry-After', String(wait));
    throw new HttpException(`Trop de tentatives. Réessayez dans ${Math.ceil(wait / 60)} min.`, HttpStatus.TOO_MANY_REQUESTS);
  }

  async failed(account: string, ip: string): Promise<void> {
    const [accountKey, ipKey] = this.keys(account, ip);
    await this.valkey
      .multi()
      .incr(accountKey)
      .expire(accountKey, WINDOW_SECONDS, 'NX')
      .incr(ipKey)
      .expire(ipKey, WINDOW_SECONDS, 'NX')
      .exec();
  }

  async succeeded(account: string): Promise<void> {
    await this.valkey.del(this.keys(account, '')[0]);
  }
}
