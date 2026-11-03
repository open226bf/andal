import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { newSessionId, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionHash, sessionStillValid, tr, userSessionsKey, type Database, type Locale, type SessionData, type User } from '@andal/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { CollabBridgeService } from '../collab-bridge.service.js';
import { config } from '../env.js';
import { DB, VALKEY } from '../infra.module.js';

/** Dernière activité d'une session: notée au plus une fois par minute. */
const SEEN_EVERY_MS = 60_000;
/** L'identifiant public d'une session: le début de son empreinte, jamais le cookie. */
const PUBLIC_ID_LENGTH = 16;

export interface OpenSession {
  id: string;
  current: boolean;
  method: SessionData['method'];
  mfa: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  device: string;
}

/** « Firefox sur macOS »: assez pour reconnaître un appareil, sans plus. */
export function describeDevice(userAgent: string | undefined, locale?: Locale): string {
  if (!userAgent) return tr(locale, 'Appareil inconnu');
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|python|httpie|node|undici/i.test(ua)
              ? 'Script'
              : tr(locale, 'Navigateur');
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  // Pas de motif « {browser} sur {os} » au catalogue: il retraduirait toute erreur contenant « sur ».
  return os ? `${browser} ${locale === 'en' ? 'on' : 'sur'} ${os}` : browser;
}

/**
 * Ouverture, suivi et fermeture des sessions, quel que soit le mode de
 * connexion. Chaque compte garde dans Valkey l'ensemble des empreintes de ses
 * sessions: on peut les lister et les fermer une à une, d'ici ou d'ailleurs.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bridge: CollabBridgeService,
  ) {}

  async open(user: User, method: SessionData['method'], req: FastifyRequest, reply: FastifyReply, extra: { idToken?: string; createdAt?: Date; mfa?: boolean } = {}) {
    // Une session déjà présente dans le navigateur est fermée: pas de fixation de session.
    const previous = req.cookies[SESSION_COOKIE];
    if (previous) await this.drop(previous);

    const sessionId = newSessionId();
    const now = (extra.createdAt ?? new Date()).toISOString();
    const data: SessionData = {
      userId: user.id,
      createdAt: now,
      method,
      ...(extra.idToken ? { idToken: extra.idToken } : {}),
      ...(extra.mfa ? { mfa: true } : {}),
      ip: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
      lastSeenAt: now,
    };
    const hash = sessionHash(sessionId);
    await this.valkey
      .multi()
      .set(`sess:${hash}`, JSON.stringify(data), 'EX', SESSION_TTL_SECONDS)
      .sadd(userSessionsKey(user.id), hash)
      .expire(userSessionsKey(user.id), SESSION_TTL_SECONDS)
      .exec();
    reply.setCookie(SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: SESSION_TTL_SECONDS,
    });
    await this.db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();
    await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip: req.ip, metadata: { method, ...(extra.mfa ? { mfa: true } : {}) } });
  }

  async close(sessionId: string, reply: FastifyReply) {
    await this.drop(sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  private async drop(sessionId: string) {
    const hash = sessionHash(sessionId);
    const raw = await this.valkey.getdel(`sess:${hash}`);
    if (raw) await this.valkey.srem(userSessionsKey((JSON.parse(raw) as SessionData).userId), hash);
  }

  /** Note l'activité de la session (garde son expiration). */
  async touch(sessionId: string, session: SessionData, ip: string) {
    if (session.lastSeenAt && Date.now() - new Date(session.lastSeenAt).getTime() < SEEN_EVERY_MS) return;
    const next: SessionData = { ...session, lastSeenAt: new Date().toISOString(), ip };
    await this.valkey.set(`sess:${sessionHash(sessionId)}`, JSON.stringify(next), 'KEEPTTL', 'XX');
  }

  /** Les sessions encore valables du compte, la plus récente d'abord. Les autres sont rangées au passage. */
  async list(user: User, currentSessionId: string | null, locale: Locale = 'fr'): Promise<OpenSession[]> {
    const key = userSessionsKey(user.id);
    const hashes = await this.valkey.smembers(key);
    if (hashes.length === 0) return [];
    const raws = await this.valkey.mget(hashes.map((h) => `sess:${h}`));
    const current = currentSessionId ? sessionHash(currentSessionId) : null;
    const open: OpenSession[] = [];
    const stale: string[] = [];
    hashes.forEach((hash, i) => {
      const raw = raws[i];
      const session = raw ? (JSON.parse(raw) as SessionData) : null;
      if (!session || session.userId !== user.id || !sessionStillValid(session, user)) {
        stale.push(hash);
        return;
      }
      open.push({
        id: hash.slice(0, PUBLIC_ID_LENGTH),
        current: hash === current,
        method: session.method,
        mfa: Boolean(session.mfa),
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt ?? session.createdAt,
        ip: session.ip ?? null,
        device: describeDevice(session.userAgent, locale),
      });
    });
    if (stale.length) {
      await this.valkey.srem(key, ...stale);
      await this.valkey.del(...stale.map((h) => `sess:${h}`));
    }
    return open.sort((a, b) => (a.current ? -1 : b.current ? 1 : b.lastSeenAt.localeCompare(a.lastSeenAt)));
  }

  /**
   * Ferme des sessions du compte: une (`id` public), ou toutes sauf `keep`.
   * Les connexions temps réel de ces sessions sont coupées aussitôt.
   */
  async revoke(user: User, which: { id: string } | { allExcept: string | null }): Promise<number> {
    const key = userSessionsKey(user.id);
    const hashes = await this.valkey.smembers(key);
    const keep = 'allExcept' in which && which.allExcept ? sessionHash(which.allExcept) : null;
    const targets = 'id' in which ? hashes.filter((h) => h.slice(0, PUBLIC_ID_LENGTH) === which.id) : hashes.filter((h) => h !== keep);
    if ('id' in which && targets.length === 0) throw new NotFoundException('Session introuvable, ou déjà fermée.');
    if (targets.length === 0) return 0;
    await this.valkey.del(...targets.map((h) => `sess:${h}`));
    await this.valkey.srem(key, ...targets);
    for (const hash of targets) await this.bridge.kick(user.id, hash);
    return targets.length;
  }
}
