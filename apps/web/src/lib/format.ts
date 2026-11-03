import { intlLocale, t, tn } from './i18n';

const dateFormat = new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short', year: 'numeric' });

/** « 2 h », « 3 j »: l'âge d'une modification, en chiffres tabulaires dans le sommaire. */
export function age(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return t('{n} min', { n: Math.max(1, minutes) });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{n} h', { n: hours });
  return t('{n} j', { n: Math.round(hours / 24) });
}

export function relative(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t("à l'instant");
  if (minutes < 60) return t('il y a {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('il y a {n} h', { n: hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t('hier') : t('il y a {n} j', { n: days });
}

export function date(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const dateTimeFormat = new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** « 2 nov. 2026, 22:41 »: le moment d'une version. */
export function dateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** « dans 6 j », « dans 3 h »: le temps qui reste avant une échéance. */
export function until(iso: string, now = Date.now()): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (minutes <= 0) return t('expirée');
  if (minutes < 60) return t('dans {n} min', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('dans {n} h', { n: hours });
  return t('dans {n} j', { n: Math.round(hours / 24) });
}

/** Ce que permet chaque rôle d'espace, en une ligne. */
export const ROLE_HELP: Record<string, string> = {
  owner: t('Tous les droits, y compris sur les admins et les autres propriétaires.'),
  admin: t('Gère les comptes; admin de tous les volumes.'),
  member: t('Voit les volumes qu’on lui ouvre; peut en créer.'),
  guest: t('Voit seulement les volumes qu’on lui ouvre. Pour les prestataires.'),
};

export function roleLabel(role: string): string {
  return ({ owner: t('propriétaire'), admin: t('admin'), member: t('membre'), guest: t('invité') } as Record<string, string>)[role] ?? role;
}

const sizeFormat = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 });

/** « 840 o », « 12 Ko », « 3,4 Mo »: le poids d'un fichier. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return t('{n} o', { n: bytes });
  if (bytes < 1024 * 1024) return t('{n} Ko', { n: sizeFormat.format(Math.round(bytes / 1024)) });
  return t('{n} Mo', { n: sizeFormat.format(bytes / 1024 / 1024) });
}

