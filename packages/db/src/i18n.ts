import { en } from './i18n-en.js';

/**
 * Langue des messages du serveur (erreurs de l'API, emails). Le français est
 * la langue source: la phrase française sert de clé, `{nom}` marque une
 * valeur. Le catalogue anglais est dans i18n-en.ts.
 */
export type Locale = 'fr' | 'en';
export const LOCALES: Locale[] = ['fr', 'en'];

export type Vars = Record<string, string | number | null | undefined>;

function fill(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (match, key: string) => (vars[key] === undefined || vars[key] === null ? match : String(vars[key]))) : text;
}

/** Une phrase dans la langue voulue (à défaut, en français). */
export function tr(locale: Locale | string | null | undefined, source: string, vars?: Vars): string {
  return fill(locale === 'en' ? (en[source] ?? source) : source, vars);
}

/** Singulier ou pluriel: le français met 0 et 1 au singulier, l'anglais seulement 1. */
export function trn(locale: Locale | string | null | undefined, n: number, one: string, other: string, vars?: Vars): string {
  const singular = locale === 'en' ? n === 1 : n <= 1;
  return tr(locale, singular ? one : other, { n, ...vars });
}

/** `Accept-Language: en-GB,en;q=0.9,fr;q=0.8` → 'en'. Sans préférence reconnue: le français. */
export function localeFromHeader(header: string | undefined): Locale {
  const ranked = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().toLowerCase().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { lang: tag.split('-')[0]!, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.lang === 'fr' || x.lang === 'en')
    .sort((a, b) => b.q - a.q);
  return (ranked[0]?.lang as Locale | undefined) ?? 'fr';
}

/* Les messages d'erreur sont écrits en français, valeurs déjà insérées
   (« Le compte de Léa est désactivé. »). Pour les traduire après coup, chaque
   phrase du catalogue devient un motif: ses `{nom}` capturent les valeurs. */
interface Pattern {
  regex: RegExp;
  keys: string[];
  target: string;
}

let patterns: Pattern[] | null = null;

function compile(): Pattern[] {
  return Object.entries(en)
    .filter(([source]) => /\{\w+\}/.test(source))
    .map(([source, target]) => {
      const keys: string[] = [];
      const body = source
        .split(/(\{\w+\})/)
        .map((part) => {
          const key = /^\{(\w+)\}$/.exec(part)?.[1];
          if (key) {
            keys.push(key);
            return '(.+?)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      return { regex: new RegExp(`^${body}$`, 's'), keys, target };
    });
}

/** Traduit un message déjà rédigé en français; inchangé s'il n'est pas au catalogue. */
export function translateMessage(message: string, locale: Locale): string {
  if (locale !== 'en') return message;
  const exact = en[message];
  if (exact !== undefined) return exact;
  patterns ??= compile();
  for (const pattern of patterns) {
    const match = pattern.regex.exec(message);
    if (match) return fill(pattern.target, Object.fromEntries(pattern.keys.map((key, i) => [key, match[i + 1]])));
  }
  return message;
}
