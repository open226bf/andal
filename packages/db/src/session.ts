import { createHash, randomBytes } from 'node:crypto';

/**
 * Sessions côté serveur, partagées par l'API et le serveur collab via Valkey.
 * Le cookie porte un identifiant aléatoire de 256 bits; Valkey ne stocke que
 * son empreinte, pour qu'une copie de Valkey ne donne aucune session utilisable.
 */

export const SESSION_COOKIE = 'andal_sid';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionData {
  userId: string;
  createdAt: string;
  /** 'token': requête signée d'un jeton d'API, sans session ni cookie. */
  method: 'password' | 'oidc' | 'token';
  /** Jeton d'identité OIDC, gardé pour la déconnexion côté fournisseur. */
  idToken?: string;
  /** Pour la liste des sessions ouvertes: d'où, avec quoi, vue quand. */
  ip?: string;
  userAgent?: string;
  lastSeenAt?: string;
  /** Mot de passe puis code à usage unique (ou code de secours). */
  mfa?: boolean;
}

/**
 * Une session n'est plus valable si le compte est désactivé, ou si elle a été
 * ouverte avant le dernier changement de mot de passe: changer son mot de passe
 * ferme toutes les autres sessions.
 */
export function sessionStillValid(session: SessionData, user: { password_changed_at: Date | null; disabled_at: Date | null }): boolean {
  if (user.disabled_at) return false;
  return !user.password_changed_at || new Date(session.createdAt) >= user.password_changed_at;
}

/** Jeton envoyé par lien (invitation, réinitialisation): 256 bits aléatoires, seule l'empreinte est stockée. */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: linkTokenHash(token) };
}

export function linkTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Préfixe des jetons d'API: reconnaissable par les scanners de secrets. */
export const API_TOKEN_PREFIX = 'andal_';

export function newApiToken(): { token: string; hash: string; prefix: string } {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: linkTokenHash(token), prefix: token.slice(0, API_TOKEN_PREFIX.length + 6) };
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionHash(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

export function sessionKey(sessionId: string): string {
  return `sess:${sessionHash(sessionId)}`;
}

/** Les sessions d'un compte (empreintes), pour les lister et les fermer une à une. */
export function userSessionsKey(userId: string): string {
  return `andal:user-sessions:${userId}`;
}

/** Jeton SCIM de l'espace, distinct des jetons d'API personnels. */
export const SCIM_TOKEN_PREFIX = 'andal_scim_';

export function newScimToken(): { token: string; hash: string; prefix: string } {
  const token = SCIM_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: linkTokenHash(token), prefix: token.slice(0, SCIM_TOKEN_PREFIX.length + 6) };
}

/** Lit un cookie dans un en-tête `Cookie` brut (pour le WebSocket du serveur collab). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
