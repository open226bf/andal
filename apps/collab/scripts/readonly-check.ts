/**
 * Vérifie que le serveur collab refuse les écritures d'une personne sans droit
 * d'édition, même si son client ignore le mode lecture seule.
 *
 *   pnpm --filter @andal/collab check:readonly
 *
 * Demande l'API (AUTH_MODE=dev), le serveur collab et la base de démo.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createDb } from '@andal/db';
import WebSocket from 'ws';
import * as Y from 'yjs';

const API = `http://127.0.0.1:${process.env.API_PORT ?? 3001}/api`;
const COLLAB = `ws://127.0.0.1:${process.env.COLLAB_PORT ?? 3002}`;

/** Se connecte avec un compte de démo (mot de passe DEMO_PASSWORD du seed). */
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

async function tryToWrite(cookie: string, pageId: string): Promise<void> {
  const socket = new HocuspocusProviderWebsocket({
    url: COLLAB,
    WebSocketPolyfill: class extends WebSocket {
      constructor(url: string) {
        super(url, { headers: { cookie } });
      }
    } as unknown as typeof globalThis.WebSocket,
  });
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `page:${pageId}`, document: doc, token: 'session-cookie' });
  // Avec une socket fournie, le provider ne s'y attache pas tout seul.
  provider.attach();
  await new Promise<void>((resolve, reject) => {
    provider.on('synced', () => resolve());
    provider.on('authenticationFailed', () => reject(new Error('Authentification refusée')));
    setTimeout(() => reject(new Error('Pas de synchronisation')), 5000);
  });
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('Écriture interdite.')]);
  doc.getXmlFragment('default').insert(0, [paragraph]);
  // Laisse passer le debounce de stockage du serveur (2 s).
  await new Promise((r) => setTimeout(r, 3500));
  provider.destroy();
  socket.destroy();
}

const db = createDb(process.env.DATABASE_URL ?? '', 1);
try {
  const page = await db.selectFrom('pages').select(['id', 'version']).where('title', '=', 'Authentification').executeTakeFirstOrThrow();
  // Léa ne fait que commenter sur ce volume. Passer « aminata » (éditrice) sert de contre-épreuve.
  const who = process.argv[2] ?? 'lea';
  await tryToWrite(await sessionCookie(who), page.id);
  const after = await db.selectFrom('pages').select(['version', 'text_content']).where('id', '=', page.id).executeTakeFirstOrThrow();
  const written = after.version !== page.version || after.text_content.includes('Écriture interdite');
  console.log(written ? `${who}: écriture acceptée, version ${page.version} → ${after.version}` : `${who}: écriture refusée, version ${after.version} inchangée`);
  process.exitCode = written === (who === 'lea') ? 1 : 0;
} finally {
  await db.destroy();
}
