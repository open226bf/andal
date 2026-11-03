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
  method: 'password' | 'oidc';
  /** Jeton d'identité OIDC, gardé pour la déconnexion côté fournisseur. */
  idToken?: string;
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

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionKey(sessionId: string): string {
  return `sess:${createHash('sha256').update(sessionId).digest('hex')}`;
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
