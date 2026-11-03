const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** « 2 h », « 3 j »: l'âge d'une modification, en chiffres tabulaires dans le sommaire. */
export function age(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

export function relative(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} j`;
}

export function date(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** « 2 nov. 2026, 22:41 »: le moment d'une version. */
export function dateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** « dans 6 j », « dans 3 h »: le temps qui reste avant une échéance. */
export function until(iso: string, now = Date.now()): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (minutes <= 0) return 'expirée';
  if (minutes < 60) return `dans ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `dans ${hours} h`;
  return `dans ${Math.round(hours / 24)} j`;
}

/** Ce que permet chaque rôle d'espace, en une ligne. */
export const ROLE_HELP: Record<string, string> = {
  owner: 'Tous les droits, y compris sur les admins et les autres propriétaires.',
  admin: 'Gère les comptes; admin de tous les volumes.',
  member: 'Voit les volumes qu’on lui ouvre; peut en créer.',
  guest: 'Voit seulement les volumes qu’on lui ouvre. Pour les prestataires.',
};

export function roleLabel(role: string): string {
  return ({ owner: 'propriétaire', admin: 'admin', member: 'membre', guest: 'invité' } as Record<string, string>)[role] ?? role;
}

const sizeFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** « 840 o », « 12 Ko », « 3,4 Mo »: le poids d'un fichier. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(Math.round(bytes / 1024))} Ko`;
  return `${sizeFormat.format(bytes / 1024 / 1024)} Mo`;
}
