import { hash, verify } from '@node-rs/argon2';

/**
 * Mots de passe locaux. Argon2id avec les réglages par défaut de @node-rs/argon2
 * (19 Mio, 2 passes, 1 fil), soit le minimum recommandé par l'OWASP.
 */

export const PASSWORD_MIN_LENGTH = 12;
/** Borne haute: au-delà, le hachage devient un levier de déni de service. */
export const PASSWORD_MAX_LENGTH = 256;

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let decoy: Promise<string> | undefined;

/**
 * Vérification factice quand l'identifiant est inconnu: la réponse prend le
 * même temps, et ne révèle donc pas quels comptes existent.
 */
export async function spendPasswordCheck(password: string): Promise<void> {
  decoy ??= hashPassword('andal-compte-inexistant');
  await verifyPassword(await decoy, password);
}

/** Règles NIST 800-63B: une longueur minimale, pas de règles de composition. */
export function passwordProblem(password: string, identity: { email: string; username: string | null }): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Le mot de passe doit faire au plus ${PASSWORD_MAX_LENGTH} caractères.`;
  const lowered = password.toLowerCase();
  const echoes = [identity.email.toLowerCase(), identity.email.split('@')[0]?.toLowerCase(), identity.username?.toLowerCase()];
  if (echoes.some((e) => e && e.length >= 3 && lowered.includes(e))) return "Le mot de passe ne doit pas contenir votre email ou votre identifiant.";
  return null;
}
