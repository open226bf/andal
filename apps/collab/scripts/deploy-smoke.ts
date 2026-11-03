/**
 * Test de fumée d'une installation déployée (deploy/compose.yaml), à travers Caddy:
 * HTTPS et en-têtes, connexion, volume, envoi et lecture d'un fichier,
 * écriture en temps réel par le WebSocket /collab, enregistrement, draw.io.
 *
 *   ANDAL_URL=https://docs.example.com ANDAL_USER=admin ANDAL_PASSWORD=… \
 *     pnpm --filter @andal/collab check:deploy
 *
 * Certificat local (essai sur localhost): ajoutez NODE_TLS_REJECT_UNAUTHORIZED=0.
 * Le test crée un volume « Essai de fumée » et le laisse en place.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';

const BASE = (process.env.ANDAL_URL ?? 'https://localhost').replace(/\/+$/, '');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let failures = 0;

function check(label: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${label}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!ok) failures += 1;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const home = await fetch(`${BASE}/`);
check('interface servie en HTTPS', home.ok && (await home.text()).includes('<div id="root">'), home.status);
check('CSP stricte sur l’interface', (home.headers.get('content-security-policy') ?? '').includes("script-src 'self'"));
check('HSTS', (home.headers.get('strict-transport-security') ?? '').includes('max-age'));
const deep = await fetch(`${BASE}/v/un-volume/une-page`);
check('les adresses de l’application renvoient l’interface', deep.ok);
const health = await fetch(`${BASE}/api/health`);
check('API en bonne santé', health.ok, await health.text());

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({ identifier: process.env.ANDAL_USER, password: process.env.ANDAL_PASSWORD }),
});
const setCookie = login.headers.get('set-cookie') ?? '';
const cookie = setCookie.split(';')[0]!;
check('connexion', login.ok, login.status);
check('cookie de session Secure et HttpOnly', /;\s*Secure/i.test(setCookie) && /HttpOnly/i.test(setCookie));
const api = (path: string, init: RequestInit = {}) => fetch(`${BASE}/api${path}`, { ...init, headers: { cookie, origin: BASE, ...(init.headers ?? {}) } });

const created = await api('/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Essai de fumée', shortName: 'Fumée' }) });
const project = (await created.json()) as { id: string; slug: string };
check('création d’un volume', created.status === 201, created.status);
const tree = (await (await api(`/projects/${project.slug}/tree`)).json()) as { pages: { id: string }[] };
const pageId = tree.pages[0]!.id;

const form = new FormData();
form.append('file', new Blob([PNG], { type: 'image/png' }), 'essai.png');
const upload = await api(`/pages/${pageId}/files`, { method: 'POST', body: form });
const file = (await upload.json()) as { id: string; image: boolean };
check('envoi d’une image (stockage S3)', upload.status === 201 && file.image, upload.status);
const download = await api(`/files/${file.id}`);
check('lecture de l’image', download.ok && Buffer.from(await download.arrayBuffer()).equals(PNG), download.status);

const socket = new HocuspocusProviderWebsocket({
  url: `${BASE.replace(/^http/, 'ws')}/collab`,
  WebSocketPolyfill: class extends WebSocket {
    constructor(url: string) {
      super(url, { headers: { cookie, origin: BASE } });
    }
  } as unknown as typeof globalThis.WebSocket,
});
const doc = new Y.Doc();
let synced = false;
const provider = new HocuspocusProvider({ websocketProvider: socket, name: `page:${pageId}`, document: doc, token: 'session-cookie', onSynced: () => (synced = true) });
provider.attach();
for (let i = 0; i < 50 && !synced; i++) await wait(200);
check('WebSocket de collaboration à travers Caddy', synced);
const marker = `Écrit par le test de fumée ${Date.now()}`;
doc.transact(() => {
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(marker)]);
  doc.getXmlFragment('default').push([paragraph]);
});
let saved = false;
for (let i = 0; i < 40 && !saved; i++) {
  await wait(500);
  const page = (await (await api(`/pages/${pageId}`)).json()) as { content: unknown };
  saved = JSON.stringify(page.content).includes(marker);
}
check('modification enregistrée en base', saved);
provider.destroy();
socket.destroy();

const drawio = await fetch(`${BASE}/drawio/`);
check('draw.io servi sous /drawio', drawio.ok, drawio.status);

console.log(`\n${failures === 0 ? 'Tout passe' : `${failures} échec(s)`}`);
process.exit(failures ? 1 : 0);
