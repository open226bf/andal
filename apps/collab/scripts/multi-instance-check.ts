/**
 * Vérifie que deux instances du serveur collab travaillent ensemble:
 *  1. une modification faite sur l'une arrive aux navigateurs de l'autre;
 *  2. une écriture demandée par l'API (contenu en Markdown) n'est faite qu'une
 *     fois, et n'ouvre qu'une version;
 *  3. un contenu refusé (hors schéma) est signalé aux éditeurs des deux
 *     instances, puis la reprise de l'enregistrement aussi.
 *
 *   pnpm --filter @andal/collab check:multi
 *
 * Demande la stack de dev (API, collab sur 3002, base de démo). Le script
 * lance lui-même une seconde instance collab sur le port 3012.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { COLLAB_QUEUE, createDb } from '@andal/db';
import { Redis } from 'ioredis';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import * as Y from 'yjs';

const API = `http://127.0.0.1:${process.env.API_PORT ?? 3001}/api`;
const FIRST = Number(process.env.COLLAB_PORT ?? 3002);
const SECOND = 3012;

async function sessionCookie(username: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: process.env.DEMO_PASSWORD ?? '' }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!res.ok || !cookie) throw new Error(`Connexion refusée pour ${username} (${res.status})`);
  return cookie;
}

interface Client {
  doc: Y.Doc;
  stateless: string[];
  close: () => void;
}

async function connect(port: number, cookie: string, pageId: string): Promise<Client> {
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}`,
    WebSocketPolyfill: class extends WebSocket {
      constructor(url: string) {
        super(url, { headers: { cookie } });
      }
    } as unknown as typeof globalThis.WebSocket,
  });
  const doc = new Y.Doc();
  const stateless: string[] = [];
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `page:${pageId}`, document: doc, token: 'session-cookie', onStateless: ({ payload }) => stateless.push(payload) });
  provider.attach();
  await new Promise<void>((resolve, reject) => {
    provider.on('synced', () => resolve());
    provider.on('authenticationFailed', () => reject(new Error('Authentification refusée')));
    setTimeout(() => reject(new Error(`Pas de synchronisation sur le port ${port}`)), 8000);
  });
  return {
    doc,
    stateless,
    close: () => {
      provider.destroy();
      socket.destroy();
    },
  };
}

const text = (doc: Y.Doc) => doc.getXmlFragment('default').toString();

async function until(label: string, test: () => boolean | Promise<boolean>, seconds = 10): Promise<boolean> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.error(`  attendu en ${seconds} s: ${label}`);
  return false;
}

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${label}`);
  if (!ok) failures += 1;
}

const second = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env: { ...process.env, COLLAB_PORT: String(SECOND) }, stdio: ['ignore', 'pipe', 'inherit'] });
const db = createDb(process.env.DATABASE_URL ?? '', 1);
const valkey = new Redis(process.env.VALKEY_URL ?? 'redis://127.0.0.1:56379');
try {
  await new Promise<void>((resolve, reject) => {
    second.stdout.on('data', (chunk: Buffer) => chunk.toString().includes('Collab Andal sur') && resolve());
    second.on('exit', (code) => reject(new Error(`Seconde instance arrêtée (${code})`)));
    setTimeout(() => reject(new Error('Seconde instance muette')), 20000);
  });

  const page = await db.selectFrom('pages').select(['id', 'version']).where('title', '=', 'Glossaire').executeTakeFirstOrThrow();
  // Aminata écrit sur Glossaire; deux navigateurs, un par instance.
  const [one, two] = await Promise.all([sessionCookie('aminata'), sessionCookie('aminata')]);
  const a = await connect(FIRST, one, page.id);
  const b = await connect(SECOND, two, page.id);

  console.log('— Synchronisation');
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('Écrit sur la première instance.')]);
  a.doc.getXmlFragment('default').insert(0, [paragraph]);
  check('une modification sur la première arrive sur la seconde', await until('texte sur B', () => text(b.doc).includes('Écrit sur la première instance.')));
  const reply = new Y.XmlElement('paragraph');
  reply.insert(0, [new Y.XmlText('Répondu depuis la seconde.')]);
  b.doc.getXmlFragment('default').insert(1, [reply]);
  check('et dans l’autre sens', await until('texte sur A', () => text(a.doc).includes('Répondu depuis la seconde.')));
  check('enregistré une fois synchronisé', await until('base à jour', async () => (await db.selectFrom('pages').select('text_content').where('id', '=', page.id).executeTakeFirstOrThrow()).text_content.includes('Répondu depuis la seconde'), 15));

  console.log('— Écriture par l’API');
  const before = Number((await db.selectFrom('page_versions').select((eb) => eb.fn.countAll<string>().as('n')).where('page_id', '=', page.id).executeTakeFirstOrThrow()).n);
  const res = await fetch(`${API}/pages/${page.id}/content`, { method: 'PUT', headers: { cookie: one, 'content-type': 'text/markdown' }, body: '# Glossaire\n\nRemplacé par l’API, une seule fois.\n' });
  check('l’API répond 200', res.ok);
  check('les deux navigateurs reçoivent le nouveau contenu', (await until('API sur A', () => text(a.doc).includes('une seule fois'))) && (await until('API sur B', () => text(b.doc).includes('une seule fois'))));
  await new Promise((r) => setTimeout(r, 3000));
  const after = Number((await db.selectFrom('page_versions').select((eb) => eb.fn.countAll<string>().as('n')).where('page_id', '=', page.id).executeTakeFirstOrThrow()).n);
  check(`une seule nouvelle version (${before} → ${after})`, after === before + 1);
  check('la commande a quitté la file: une seule instance l’a prise', (await valkey.llen(COLLAB_QUEUE)) === 0);

  console.log('— Enregistrement refusé');
  const bad = new Y.XmlElement('script');
  bad.insert(0, [new Y.XmlText('hors schéma')]);
  a.doc.getXmlFragment('default').insert(0, [bad]);
  check('les éditeurs des deux instances sont prévenus', (await until('refus sur A', () => a.stateless.includes('save-rejected'))) && (await until('refus sur B', () => b.stateless.includes('save-rejected'))));
  const stored = (await db.selectFrom('pages').select('content').where('id', '=', page.id).executeTakeFirstOrThrow()).content;
  check('rien n’est enregistré', !JSON.stringify(stored).includes('hors schéma'));
  a.doc.getXmlFragment('default').delete(0, 1);
  check('annuler fait repartir l’enregistrement, annoncé aussi', (await until('reprise sur A', () => a.stateless.includes('save-ok'))) && (await until('reprise sur B', () => b.stateless.includes('save-ok'))));

  a.close();
  b.close();
} finally {
  second.kill('SIGTERM');
  valkey.disconnect();
  await db.destroy();
}
console.log(failures === 0 ? '\nTout passe' : `\n${failures} échec(s)`);
process.exit(failures === 0 ? 0 : 1);
