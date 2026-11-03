import { Fragment, type ReactNode } from 'react';
import { en } from '../i18n/en';

/**
 * Langue de l'interface. Le français est la langue source: chaque phrase
 * française sert de clé, et le catalogue anglais (src/i18n/en/) la traduit.
 * Une phrase absente du catalogue s'affiche en français plutôt que vide.
 *
 *   t('Mon compte')                                 → « My account »
 *   t('Supprimer la spec {name} ?', { name })       → « Delete the {name} spec? »
 *   tn(n, '{n} page', '{n} pages')                  → pluriel selon la langue
 *   tx('Le dossier {path} de…', { path: <code/> })  → phrase avec des éléments
 */

export type Locale = 'fr' | 'en';

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
];

const STORAGE_KEY = 'andal:locale';

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    // Stockage indisponible (navigation privée): la langue du navigateur.
  }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export const locale: Locale = detect();

/** Pour Intl (dates, nombres): « fr-FR » ou « en-GB » (jour, mois, année). */
export const intlLocale = locale === 'fr' ? 'fr-FR' : 'en-GB';
document.documentElement.lang = locale;

/** Change de langue: retenue dans ce navigateur, puis la page se recharge dans la nouvelle langue. */
export function setLocale(next: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Sans stockage, le choix ne dure que jusqu'au rechargement.
  }
  location.reload();
}

export type Vars = Record<string, string | number | null | undefined>;

function template(source: string): string {
  return locale === 'en' ? (en[source] ?? source) : source;
}

function fill(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (match, key: string) => (vars[key] === undefined || vars[key] === null ? match : String(vars[key]))) : text;
}

/** Une phrase de l'interface, dans la langue choisie. `{nom}` est remplacé par `vars.nom`. */
export function t(source: string, vars?: Vars): string {
  return fill(template(source), vars);
}

const rules = new Intl.PluralRules(locale);

/**
 * Singulier ou pluriel selon la langue: le français met 0 et 1 au singulier,
 * l'anglais seulement 1. `{n}` reçoit le nombre.
 */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  return t(rules.select(n) === 'one' ? one : other, { n, ...vars });
}

/** Une phrase dont certaines parties sont des éléments (lien, code, gras): `{nom}` reçoit `vars.nom`, un nœud React. */
export function tx(source: string, vars: Record<string, ReactNode>): ReactNode {
  return template(source)
    .split(/(\{\w+\})/)
    .map((part, i) => {
      const key = /^\{(\w+)\}$/.exec(part)?.[1];
      return key !== undefined && key in vars ? <Fragment key={i}>{vars[key]}</Fragment> : part;
    });
}
