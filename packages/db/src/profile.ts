import { sql, type Kysely } from 'kysely';
import type { Database } from './schema.js';
/** Teintes d'avatar, attribuées à tour de rôle aux nouveaux comptes. */
export const PROFILE_COLORS = ['#F2B33D', '#5B4FD6', '#C2366A', '#3B6FB6', '#157F73', '#D9622B'] as const;

export function profileColor(index: number): string {
  return PROFILE_COLORS[index % PROFILE_COLORS.length]!;
}

/** « Aminata Koné » → « AK ». */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{2,40}$/;
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Identifiant proposé à partir d'un email: « léa.m@x.fr » → « lea.m ». */
export function suggestUsername(email: string): string {
  const local = (email.split('@')[0] ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return local.slice(0, 40);
}

/** « lea », sinon « lea-2 », « lea-3 »…: le premier identifiant libre de l'espace. */
export async function freeUsername(db: Kysely<Database>, workspaceId: string, base: string): Promise<string> {
  const stem = (base.length >= 2 ? base : `compte${base}`).slice(0, 36);
  const taken = await db
    .selectFrom('users')
    .select(sql<string>`lower(username)`.as('u'))
    .where('workspace_id', '=', workspaceId)
    .where(sql<string>`lower(username)`, 'like', `${stem.replace(/[%_\\]/g, '\\$&')}%`)
    .execute();
  const used = new Set(taken.map((t) => t.u));
  if (!used.has(stem)) return stem;
  for (let i = 2; ; i += 1) if (!used.has(`${stem}-${i}`)) return `${stem}-${i}`;
}
