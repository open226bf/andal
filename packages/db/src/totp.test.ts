import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, totpCode, verifyTotp } from './totp.js';

// RFC 6238, annexe B: la clé SHA1 « 12345678901234567890 », codes à 8 chiffres.
const RFC_KEY = Buffer.from('12345678901234567890');

describe('TOTP', () => {
  it('suit les vecteurs de la RFC 6238', () => {
    expect(hotp(RFC_KEY, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(RFC_KEY, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(RFC_KEY, Math.floor(2000000000 / 30), 8)).toBe('69279037');
  });

  it('encode et décode le base32 des applications', () => {
    expect(base32Encode(RFC_KEY)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv-gy3tqojq gezdgnbvgy3tqojq')).toEqual(RFC_KEY);
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it('accepte le code du moment et un pas de décalage, pas plus', () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now), null, now)).toBe(60_000_000);
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), null, now)).toBe(59_999_999);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), null, now)).toBe(60_000_001);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), null, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('refuse un code déjà servi', () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = verifyTotp(secret, totpCode(secret, now), null, now);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now), step, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), step, now)).toBe(step! + 1);
  });

  it("donne l'adresse otpauth des applications", () => {
    expect(otpauthUri('ABC', 'lea@andal.test')).toBe('otpauth://totp/Andal%3Alea%40andal.test?secret=ABC&issuer=Andal&algorithm=SHA1&digits=6&period=30');
  });
});

describe('codes de secours', () => {
  it('sont lisibles, distincts, et se recopient sans souci de casse', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(normalizeRecoveryCode(' K7M2P x9qrt ')).toBe('k7m2p-x9qrt');
    expect(normalizeRecoveryCode('k7m2p')).toBeNull();
  });
});
