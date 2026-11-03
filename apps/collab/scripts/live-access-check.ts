/**
 * Vérifie qu'un changement de droits s'applique aux connexions déjà ouvertes:
 * Aminata écrit sur « Glossaire », Camille lui retire l'écriture (restriction),
 * puis la lecture. Sans recharger, sa connexion doit passer en lecture seule,
 * puis être fermée. Ensuite, sur « Conventions », Camille archive le volume:
 * la page ouverte passe en lecture seule, et redevient modifiable au
 * désarchivage.
 *
 *   pnpm --filter @andal/collab check:live-access
 *
 * Demande l'API, le serveur collab et la base de démo; relancez `pnpm db:seed` ensuite.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createDb } from '@andal/db';
import WebSocket from 'ws';
import * as Y from 'yjs';

const API = `http://127.0.0.1:${process.env.API_PORT ?? 3001}/api`;
const COLLAB = `ws://127.0.0.1:${process.env.COLLAB_PORT ?? 3002}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function restrict(cookie: string, pageId: string, kind: 'view' | 'edit', principals: { type: 'user'; id: string }[]) {
  const res = await fetch(`${API}/pages/${pageId}/restrictions/${kind}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ principals }) });
  if (res.status !== 204) throw new Error(`Restriction ${kind} refusée: ${res.status} ${await res.text()}`);
}

async function volume(cookie: string, projectId: string, op: 'archive' | 'unarchive') {
  const res = await fetch(`${API}/projects/${projectId}/${op}`, { method: 'POST', headers: { cookie } });
  if (res.status !== 204) throw new Error(`${op} refusé: ${res.status} ${await res.text()}`);
}

/** Une page ouverte dans un navigateur: le document partagé et ce que le serveur lui signale. */
async function open(cookie: string, pageId: string) {
  const socket = new HocuspocusProviderWebsocket({
    url: COLLAB,
    WebSocketPolyfill: class extends WebSocket {
      constructor(url: string) {
        super(url, { headers: { cookie } });
      }
    } as unknown as typeof globalThis.WebSocket,
  });
  const doc = new Y.Doc();
  const state = { signals: [] as string[], closed: false };
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `page:${pageId}`,
    document: doc,
    token: 'session-cookie',
    onStateless: ({ payload }) => state.signals.push(payload),
    onClose: () => {
      state.closed = true;
    },
  });
  provider.attach();
  await new Promise<void>((resolve, reject) => {
    provider.on('synced', () => resolve());
    setTimeout(() => reject(new Error('Pas de synchronisation')), 5000);
  });
  const write = async (text: string) => {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(text)]);
    doc.getXmlFragment('default').push([paragraph]);
    await wait(3500); // debounce de stockage du serveur (2 s)
  };
  const close = () => {
    provider.destroy();
    socket.destroy();
  };
  return { state, write, close };
}

const db = createDb(process.env.DATABASE_URL ?? '', 1);
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  const page = await db.selectFrom('pages').innerJoin('projects', 'projects.id', 'pages.project_id').select(['pages.id']).where('pages.title', '=', 'Glossaire').where('projects.slug', '=', 'paiements').executeTakeFirstOrThrow();
  const thomas = await db.selectFrom('users').select('id').where('username', '=', 'thomas').executeTakeFirstOrThrow();
  const [aminata, camille] = await Promise.all([sessionCookie('aminata'), sessionCookie('camille')]);
  const version = async () => (await db.selectFrom('pages').select(['version', 'text_content']).where('id', '=', page.id).executeTakeFirstOrThrow());

  const glossaire = await open(aminata, page.id);
  const signals = glossaire.state.signals;
  const write = glossaire.write;

  const v0 = await version();
  await write('Écrit avant la restriction.');
  const v1 = await version();
  // Le contenu fait foi: dans la même séance de travail, le numéro de version ne bouge pas.
  check('éditrice: écriture acceptée', v1.text_content.includes('avant la restriction'), `version ${v0.version} → ${v1.version}`);

  await restrict(camille, page.id, 'edit', [{ type: 'user', id: thomas.id }]);
  await wait(800);
  check('le navigateur ouvert est prévenu du changement de droits', signals.includes('access-changed'), signals.join(', '));
  await write('Écrit après la restriction.');
  const v2 = await version();
  check('écriture retirée: la connexion ouverte passe en lecture seule', v2.version === v1.version && !v2.text_content.includes('après la restriction'), `version ${v2.version}`);

  await restrict(camille, page.id, 'view', [{ type: 'user', id: thomas.id }]);
  await wait(800);
  check('lecture retirée: la connexion ouverte est fermée', glossaire.state.closed);

  await restrict(camille, page.id, 'view', []);
  await restrict(camille, page.id, 'edit', []);
  glossaire.close();

  // Archiver le volume fige aussi les pages déjà ouvertes.
  const conventions = await db.selectFrom('pages').innerJoin('projects', 'projects.id', 'pages.project_id').select(['pages.id', 'projects.id as projectId']).where('pages.title', '=', 'Conventions').where('projects.slug', '=', 'paiements').executeTakeFirstOrThrow();
  const textOf = async () => (await db.selectFrom('pages').select('text_content').where('id', '=', conventions.id).executeTakeFirstOrThrow()).text_content;
  // Deux onglets: l'un tente d'écrire pendant l'archivage (son document diverge alors), l'autre attend.
  const [tried, waited] = await Promise.all([open(aminata, conventions.id), open(aminata, conventions.id)]);
  await volume(camille, conventions.projectId, 'archive');
  await wait(800);
  check('volume archivé: le navigateur ouvert est prévenu', tried.state.signals.includes('access-changed'), tried.state.signals.join(', '));
  await tried.write('Écrit dans un volume archivé.');
  check('volume archivé: la page ouverte passe en lecture seule', !(await textOf()).includes('volume archivé'));
  await volume(camille, conventions.projectId, 'unarchive');
  await wait(800);
  await waited.write('Écrit après le désarchivage.');
  check('désarchivé: la connexion restée ouverte écrit de nouveau', (await textOf()).includes('après le désarchivage'));
  tried.close();
  waited.close();
} finally {
  await db.destroy();
}
process.exitCode = failures ? 1 : 0;
