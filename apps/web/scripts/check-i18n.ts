/**
 * Vérifie le catalogue anglais de l'interface:
 *  - chaque phrase passée à t(), tn() ou tx() dans src/ a sa traduction;
 *  - la traduction garde les mêmes valeurs `{nom}` que la phrase française;
 *  - aucune traduction n'est vide.
 * Les entrées que plus rien n'utilise sont signalées, sans faire échouer.
 *
 *   pnpm --filter @andal/web check:i18n             (--unused: les lister)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? files(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))));
  return nested.flat().filter((f) => /\.(ts|tsx)$/.test(f));
}

/** Un littéral de chaîne JavaScript ('…', "…" ou `…` sans ${}), décodé. */
const LITERAL = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\`(?:[^\`\\$]|\\.)*\``;
/* t() et tx(): la phrase en premier argument. tn(): d'abord le nombre, puis les deux formes. */
const CALL = new RegExp(String.raw`\b(t|tx)\(\s*(${LITERAL})|\b(tn)\(\s*[^,()]*?(?:\([^()]*\))?[^,()]*?,\s*(${LITERAL})\s*,\s*(${LITERAL})`, 'g');

function decode(literal: string): string {
  const body = literal.slice(1, -1);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (_, esc: string) => {
    if (esc.startsWith('u{')) return String.fromCodePoint(parseInt(esc.slice(2, -1), 16));
    if (esc.startsWith('u') && esc.length === 5) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return ({ n: '\n', t: '\t' } as Record<string, string>)[esc] ?? esc;
  });
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const sources = (await files(root)).filter((f) => !f.includes(`${join('src', 'i18n')}`) && !f.endsWith(join('lib', 'i18n.tsx')));
const used = new Map<string, string>();
for (const file of sources) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(CALL)) {
    const [, , phrase, , one, other] = match;
    const keys = phrase ? [phrase] : [one, other];
    for (const key of keys) if (key) used.set(decode(key), relative(root, file));
  }
}

const catalog: Record<string, string> = {};
const origin: Record<string, string> = {};
let problems = 0;
for (const file of (await readdir(join(root, 'i18n', 'en'))).filter((f) => f.endsWith('.ts') && f !== 'index.ts')) {
  const part = (await import(join(root, 'i18n', 'en', file))) as { default: Record<string, string> };
  for (const [key, english] of Object.entries(part.default)) {
    // Les fragments sont fusionnés: une même phrase traduite deux fois différemment, l'une écraserait l'autre.
    if (key in catalog && catalog[key] !== english) {
      console.log(`Traductions en conflit pour ${JSON.stringify(key)}: ${JSON.stringify(catalog[key])} (${origin[key]}) / ${JSON.stringify(english)} (${file})`);
      problems += 1;
    }
    catalog[key] = english;
    origin[key] = file;
  }
}

for (const [key, file] of used) {
  const english = catalog[key];
  if (english === undefined) {
    console.log(`Sans traduction (${file}): ${JSON.stringify(key)}`);
    problems += 1;
  } else if (!english.trim()) {
    console.log(`Traduction vide (${file}): ${JSON.stringify(key)}`);
    problems += 1;
  } else if (placeholders(key) !== placeholders(english)) {
    console.log(`Valeurs différentes (${file}): ${JSON.stringify(key)} → ${JSON.stringify(english)}`);
    problems += 1;
  }
}
const unused = Object.keys(catalog).filter((k) => !used.has(k));
if (unused.length) console.log(`\n${unused.length} entrée(s) du catalogue sans usage repéré (appel construit autrement, ou à retirer).`);
if (process.argv.includes('--unused')) for (const key of unused) console.log(`  ${JSON.stringify(key)}`);
console.log(`\n${used.size} phrases utilisées, ${Object.keys(catalog).length} au catalogue, ${problems} problème(s).`);
process.exit(problems ? 1 : 0);
