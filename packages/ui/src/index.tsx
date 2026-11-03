import type { CSSProperties } from 'react';

export type AccessLevel = 'write' | 'comment' | 'read';
export type Role = 'reader' | 'commenter' | 'editor' | 'admin';

const LABELS: Record<AccessLevel, string> = {
  write: 'Écriture',
  comment: 'Commentaire',
  read: 'Lecture',
};

export function accessLevel(role: Role): AccessLevel {
  if (role === 'editor' || role === 'admin') return 'write';
  if (role === 'commenter') return 'comment';
  return 'read';
}

export function accessLabel(level: AccessLevel): string {
  return LABELS[level];
}

/** Le signe d'accès: plein pour écrire, hachuré pour commenter, contour pour lire. */
export function AccessMark({ level, label }: { level: AccessLevel; label?: string }) {
  return (
    <span
      className={`mark ${level}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Encre lisible sur une couleur: bleu-noir sur les toiles claires, blanc sinon. */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum > 0.4 ? '#1C2230' : '#FFFFFF';
}

export function Avatar({ initials, color, size = 28, title }: { initials: string; color: string; size?: number; title?: string }) {
  const style = { '--c': color, '--c-on': inkOn(color), width: size, height: size, fontSize: Math.round(size * 0.39) } as CSSProperties;
  return (
    <span className="av" style={style} title={title}>
      {initials}
    </span>
  );
}
