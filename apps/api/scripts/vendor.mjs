/**
 * Copie dans dist/vendor ce que l'export PDF envoie au moteur d'impression
 * (Gotenberg): mermaid.js, qui dessine les diagrammes, et les polices de
 * l'interface. Ces paquets ne servent qu'au build: l'image de production
 * n'embarque que les fichiers copiés.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'vendor');
const files = [
  'mermaid/dist/mermaid.min.js',
  '@fontsource-variable/literata/files/literata-latin-opsz-normal.woff2',
  '@fontsource-variable/literata/files/literata-latin-opsz-italic.woff2',
  '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2',
  '@fontsource/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2',
];

await mkdir(out, { recursive: true });
for (const file of files) {
  // Le paquet se résout par son package.json: ses « exports » ne listent pas ces fichiers.
  const root = dirname(require.resolve(`${file.split('/').slice(0, file.startsWith('@') ? 2 : 1).join('/')}/package.json`));
  const rest = file.split('/').slice(file.startsWith('@') ? 2 : 1).join('/');
  await copyFile(join(root, rest), join(out, basename(file)));
}
