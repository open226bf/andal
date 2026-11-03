import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { linkTokenHash } from './session.js';

/**
 * Double authentification par codes à usage unique (TOTP, RFC 6238): HMAC-SHA1,
 * pas de 30 secondes, 6 chiffres, comme toutes les applications d'authentification.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;
const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Secret base32 invalide');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bits, la taille d'une clé HMAC-SHA1. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

export function totpStep(at = Date.now()): number {
  return Math.floor(at / 1000 / TOTP_PERIOD);
}

export function totpCode(secret: string, at = Date.now()): string {
  return hotp(base32Decode(secret), totpStep(at));
}

/**
 * Le pas accepté, ou null. Tolère un pas d'écart de chaque côté (horloge du
 * téléphone), et refuse tout pas déjà servi (`lastStep`): un code ne sert qu'une fois.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, at = Date.now()): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const key = base32Decode(secret);
  const now = totpStep(at);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqualText(hotp(key, step), digits)) return step;
  }
  return null;
}

function timingSafeEqualText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Adresse `otpauth://` lue par les applications (QR code). */
export function otpauthUri(secret: string, account: string, issuer = 'Andal'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_PERIOD}`;
}

/* ---------- Codes de secours ---------- */

/** Sans 0/O ni 1/I/L: un code se recopie sans hésiter. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_CODE_COUNT = 10;

/** « k7m2p-x9qrt »: 10 caractères, environ 49 bits. */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Casse, espaces et tiret ignorés: « K7M2P X9QRT » vaut « k7m2p-x9qrt ». */
export function normalizeRecoveryCode(code: string): string | null {
  const clean = code.toLowerCase().replace(/[\s-]/g, '');
  return /^[a-z0-9]{10}$/.test(clean) ? `${clean.slice(0, 5)}-${clean.slice(5)}` : null;
}

export function recoveryCodeHash(code: string): string {
  return linkTokenHash(`recovery:${code}`);
}
