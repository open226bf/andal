/**
 * Serveur de collaboration temps réel (Hocuspocus + Yjs).
 *
 * Les droits s'appliquent au niveau du WebSocket: sans lecture, la connexion
 * est refusée; sans écriture, elle est ouverte en lecture seule et le serveur
 * ignore toute modification envoyée par ce client.
 *
 * Plusieurs instances peuvent tourner côte à côte: l'extension Redis de
 * Hocuspocus synchronise les documents ouverts sur plusieurs instances (et un
 * verrou n'en laisse qu'une enregistrer), les annonces de l'API arrivent à
 * toutes, et chaque écriture demandée par l'API n'est prise que par une seule.
 */
import { can } from '@andal/authz';
import {
  ACCESS_CHANGED,
  COLLAB_CHANNEL,
  COLLAB_QUEUE,
  collabReplyKey,
  createDb,
  loadSubject,
  NOTIFICATIONS_CHANGED,
  pageRoleFor,
  recordVersion,
  SAVE_OK,
  SAVE_REJECTED,
  TREE_CHANGED,
  readCookie,
  requireEnv,
  SESSION_COOKIE,
  sessionHash,
  sessionKey,
  sessionStillValid,
  THREADS_CHANGED,
  type CollabCommand,
  type LoadedSubject,
  type SessionData,
} from '@andal/db';
import { andalSchema, sameDoc, validateDoc, type JSONContent } from '@andal/editor';
import { Redis as RedisSync } from '@hocuspocus/extension-redis';
import { Server } from '@hocuspocus/server';
import { prosemirrorJSONToYDoc, prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { hostname } from 'node:os';
import * as Y from 'yjs';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // Pas de .env: environnement du processus.
}

/** Nom du fragment Yjs utilisé par l'extension Collaboration de TipTap. */
const FIELD = 'default';
const PAGE_DOCUMENT = /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

interface Context {
  /** Null pour les écritures du serveur lui-même (ancres de commentaires). */
  userId: string | null;
  pageId: string;
  /** Ajout ou retrait d'une ancre: ni nouvelle version, ni « modifiée par ». */
  annotation?: boolean;
  /** Restauration d'une ancienne version: toujours une nouvelle version. */
  restore?: boolean;
  /** Empreinte de la session du navigateur: fermer la session coupe ses connexions. */
  session?: string;
}

const valkeyUrl = process.env.VALKEY_URL ?? 'redis://127.0.0.1:56379';
const db = createDb(requireEnv('DATABASE_URL'));
const valkey = new Redis(valkeyUrl);
const queue = new Queue('andal', { connection: new Redis(valkeyUrl, { maxRetriesPerRequest: null }) });

/** Page dont le dernier enregistrement a été refusé (dans Valkey: l'instance qui enregistre ensuite n'est pas forcément la même). */
const rejectedKey = (pageId: string) => `andal:collab:rejected:${pageId}`;

function pageIdOf(documentName: string): string {
  const id = PAGE_DOCUMENT.exec(documentName)?.[1];
  if (!id) throw new Error('Document inconnu');
  return id;
}

const server = new Server({
  name: 'andal-collab',
  port: Number(process.env.COLLAB_PORT ?? 3002),
  // 127.0.0.1 en dev; 0.0.0.0 dans un conteneur.
  address: process.env.HOST?.trim() || '127.0.0.1',
  debounce: 2000,
  maxDebounce: 10000,
  quiet: true,
  extensions: [
    new RedisSync({
      redis: valkey,
      prefix: 'andal:collab:sync',
      // Unique par processus: les messages d'une instance ne lui reviennent pas.
      identifier: `${hostname()}:${process.pid}`,
      // L'enregistrement (base, version, indexation) peut prendre plus d'une seconde.
      lockTimeout: 10_000,
    }),
  ],

  async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
    const pageId = pageIdOf(documentName);
    const sessionId = readCookie(requestHeaders.cookie, SESSION_COOKIE);
    if (!sessionId) throw new Error('Session absente');
    const raw = await valkey.get(sessionKey(sessionId));
    if (!raw) throw new Error('Session expirée');

    const session = JSON.parse(raw) as SessionData;
    const { userId } = session;
    const loaded = await loadSubject(db, userId);
    if (!loaded || !sessionStillValid(session, loaded.user)) throw new Error('Session révoquée');

    const access = await pageRoleFor(db, loaded.subject, pageId);
    if (!access?.role || !can(access.role, 'page.read')) throw new Error('Accès refusé');
    connectionConfig.readOnly = !can(access.role, 'page.edit');

    return { userId, pageId, session: sessionHash(sessionId) } satisfies Context;
  },

  async onLoadDocument({ documentName, document }) {
    const pageId = pageIdOf(documentName);
    const page = await db.selectFrom('pages').select(['content', 'ydoc']).where('id', '=', pageId).executeTakeFirst();
    if (!page) throw new Error('Page introuvable');

    if (page.ydoc) {
      Y.applyUpdate(document, new Uint8Array(page.ydoc));
    } else {
      // Première ouverture: l'état Yjs est construit depuis le JSON, avec le schéma partagé.
      const seeded = prosemirrorJSONToYDoc(andalSchema(), page.content, FIELD);
      Y.applyUpdate(document, Y.encodeStateAsUpdate(seeded));
    }
    return document;
  },

  async onStoreDocument({ document, context }) {
    const { userId, pageId, annotation, restore } = context as Context;
    const json = yXmlFragmentToProsemirrorJSON(document.getXmlFragment(FIELD)) as JSONContent;

    // Le schéma est une liste blanche: un contenu non conforme n'est jamais
    // enregistré, et les éditeurs ouverts en sont prévenus tout de suite.
    const invalid = validateDoc(json);
    if (invalid) {
      console.warn(`Contenu refusé pour ${pageId}: ${invalid}`);
      await valkey.set(rejectedKey(pageId), '1', 'EX', 24 * 3600);
      document.broadcastStateless(SAVE_REJECTED);
      return;
    }
    if (await valkey.del(rejectedKey(pageId))) document.broadcastStateless(SAVE_OK);

    // Une ancre ne change pas le texte, et un état Yjs qui redit la même chose
    // (normalisation à l'ouverture, reconnexion) n'est pas une modification:
    // ni nouvelle version, ni « modifiée par », ni réindexation.
    const stored = annotation ? null : await db.selectFrom('pages').select('content').where('id', '=', pageId).executeTakeFirst();
    if (annotation || (stored && sameDoc(stored.content as JSONContent, json))) {
      await db.updateTable('pages').set({ content: JSON.stringify(json), ydoc: Buffer.from(Y.encodeStateAsUpdate(document)) }).where('id', '=', pageId).execute();
      return;
    }

    await db
      .updateTable('pages')
      .set({ content: JSON.stringify(json), ydoc: Buffer.from(Y.encodeStateAsUpdate(document)), updated_by: userId, updated_at: new Date() })
      .where('id', '=', pageId)
      .execute();
    // Prolonge la version en cours ou en ouvre une nouvelle (séances de 10 minutes).
    await recordVersion(db, pageId, userId, { fresh: restore });
    await queue.add('page.index', { pageId }, { removeOnComplete: 100, removeOnFail: 500 });
  },
});

/* ---------- Commandes de l'API (via Valkey) ---------- */

function decodePosition(base64: string): Y.RelativePosition {
  return Y.decodeRelativePosition(new Uint8Array(Buffer.from(base64, 'base64')));
}

/** Écrit dans le document comme le serveur, hors de toute connexion utilisateur. */
async function asServer(pageId: string, write: (document: Y.Doc) => void): Promise<void> {
  const connection = await server.hocuspocus.openDirectConnection(`page:${pageIdOf(`page:${pageId}`)}`, { userId: null, pageId, annotation: true } satisfies Context);
  try {
    await connection.transact(write);
  } finally {
    await connection.disconnect();
  }
}

/**
 * Pose la marque `comment` entre deux positions relatives. Elles restent justes
 * même si le texte a bougé depuis la sélection. L'ancre doit tenir dans un seul
 * bloc de texte: sinon 'invalid', et l'API ne crée pas le fil.
 */
async function anchor(pageId: string, threadId: string, from: string, to: string): Promise<'ok' | 'invalid'> {
  let result: 'ok' | 'invalid' = 'invalid';
  await asServer(pageId, (document) => {
    const start = Y.createAbsolutePositionFromRelativePosition(decodePosition(from), document);
    const end = Y.createAbsolutePositionFromRelativePosition(decodePosition(to), document);
    if (!start || !end || start.type !== end.type || !(start.type instanceof Y.XmlText) || end.index <= start.index) return;
    // Le bloc doit admettre la marque (pas de commentaire dans un bloc de code, par exemple).
    const block = start.type.parent;
    const schema = andalSchema();
    const nodeType = block instanceof Y.XmlElement ? schema.nodes[block.nodeName] : undefined;
    if (!nodeType || !schema.marks.comment || !nodeType.allowsMarkType(schema.marks.comment)) return;
    start.type.format(start.index, end.index - start.index, { comment: { threadId } });
    result = 'ok';
  });
  return result;
}

/**
 * Remplace le contenu du document vivant: les navigateurs ouverts le reçoivent
 * aussitôt, et l'enregistrement qui suit ouvre une nouvelle version au nom de
 * `userId`. Sert à restaurer une version et à écrire par l'API.
 */
async function writeContent(pageId: string, content: JSONContent, userId: string | null): Promise<'ok' | 'same' | 'invalid'> {
  if (validateDoc(content)) return 'invalid';
  const connection = await server.hocuspocus.openDirectConnection(`page:${pageId}`, { userId, pageId, restore: true } satisfies Context);
  let result: 'ok' | 'same' = 'ok';
  try {
    await connection.transact((document) => {
      const fragment = document.getXmlFragment(FIELD);
      if (sameDoc(yXmlFragmentToProsemirrorJSON(fragment) as JSONContent, content)) {
        result = 'same';
        return;
      }
      // Mise à jour par différence: ce qui n'a pas changé reste en place chez les autres.
      prosemirrorJSONToYXmlFragment(andalSchema(), content, fragment);
    });
  } finally {
    await connection.disconnect();
  }
  return result;
}

async function restoreVersion(pageId: string, versionId: string, userId: string): Promise<'ok' | 'same' | 'invalid'> {
  const version = await db.selectFrom('page_versions').select('content').where('id', '=', versionId).where('page_id', '=', pageId).executeTakeFirst();
  if (!version) return 'invalid';
  return writeContent(pageId, version.content as JSONContent, userId);
}

/** Retire toutes les marques d'un fil supprimé. */
async function unanchor(pageId: string, threadId: string): Promise<void> {
  await asServer(pageId, (document) => {
    const visit = (node: Y.XmlElement | Y.XmlFragment | Y.XmlText) => {
      if (node instanceof Y.XmlText) {
        let index = 0;
        for (const op of node.toDelta() as { insert: unknown; attributes?: { comment?: { threadId?: string } } }[]) {
          const length = typeof op.insert === 'string' ? op.insert.length : 1;
          if (op.attributes?.comment?.threadId === threadId) node.format(index, length, { comment: null });
          index += length;
        }
        return;
      }
      for (const child of node.toArray()) if (child instanceof Y.XmlElement || child instanceof Y.XmlText) visit(child);
    };
    visit(document.getXmlFragment(FIELD));
  });
}

/**
 * Les droits ont changé quelque part: chaque connexion ouverte est revérifiée.
 * Sans lecture, elle est fermée; sinon elle passe en lecture seule ou en
 * écriture selon le rôle du moment. Les navigateurs relisent leur page.
 */
async function recheckAccess(): Promise<void> {
  const subjects = new Map<string, LoadedSubject | null>();
  for (const document of server.hocuspocus.documents.values()) {
    const pageId = PAGE_DOCUMENT.exec(document.name)?.[1];
    if (!pageId) continue;
    document.broadcastStateless(ACCESS_CHANGED);
    for (const connection of document.getConnections()) {
      const userId = (connection.context as Context | undefined)?.userId;
      if (!userId) continue;
      if (!subjects.has(userId)) subjects.set(userId, await loadSubject(db, userId));
      const loaded = subjects.get(userId);
      const access = loaded && !loaded.user.disabled_at ? await pageRoleFor(db, loaded.subject, pageId) : null;
      if (!access?.role || !can(access.role, 'page.read')) {
        connection.close();
        continue;
      }
      connection.readOnly = !can(access.role, 'page.edit');
    }
  }
}

async function handle(command: CollabCommand): Promise<void> {
  if (command.op === 'access') {
    await recheckAccess();
    return;
  }
  if (command.op === 'tree') {
    for (const document of server.hocuspocus.documents.values()) document.broadcastStateless(TREE_CHANGED);
    return;
  }
  if (command.op === 'notify') {
    // Seulement aux connexions des comptes concernés: le message ne dit rien de plus.
    const targets = new Set(command.userIds);
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        if (targets.has((connection.context as Context | undefined)?.userId ?? '')) connection.sendStateless(NOTIFICATIONS_CHANGED);
      }
    }
    return;
  }
  if (command.op === 'threads') {
    // Les navigateurs de la page rechargent les fils; personne d'autre ne reçoit rien.
    server.hocuspocus.documents.get(`page:${command.pageId}`)?.broadcastStateless(THREADS_CHANGED);
    return;
  }
  if (command.op === 'kick') {
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        const context = connection.context as Context | undefined;
        if (context?.userId === command.userId && (!command.sessionHash || context.session === command.sessionHash)) connection.close();
      }
    }
    return;
  }
  let reply = 'ok';
  try {
    if (command.op === 'anchor') reply = await anchor(command.pageId, command.threadId, command.from, command.to);
    else if (command.op === 'restore') reply = await restoreVersion(command.pageId, command.versionId, command.userId);
    else if (command.op === 'replace') reply = await writeContent(command.pageId, command.content as JSONContent, command.userId);
    else await unanchor(command.pageId, command.threadId);
  } catch (error) {
    console.error(`Commande ${command.op} en échec:`, error);
    reply = 'error';
  }
  const key = collabReplyKey(command.requestId);
  await valkey.multi().lpush(key, reply).expire(key, 30).exec();
}

const subscriber = valkey.duplicate();
await subscriber.subscribe(COLLAB_CHANNEL);
subscriber.on('message', (_channel, raw) => {
  let command: CollabCommand;
  try {
    command = JSON.parse(raw) as CollabCommand;
  } catch {
    return;
  }
  handle(command).catch((error: unknown) => console.error(`Commande ${command.op} en échec:`, error));
});

/**
 * Les écritures demandées par l'API (ancres, restaurations, remplacements)
 * arrivent par une file: chaque commande n'est prise que par une instance.
 * Une commande dont plus personne n'attend la réponse est abandonnée.
 */
const queueReader = valkey.duplicate();
let stopping = false;
async function consumeWrites(): Promise<void> {
  while (!stopping) {
    let raw: string | undefined;
    try {
      raw = (await queueReader.brpop(COLLAB_QUEUE, 5))?.[1];
    } catch (error) {
      if (stopping) return;
      console.error('File des écritures collab indisponible:', error);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (!raw) continue;
    let command: CollabCommand;
    try {
      command = JSON.parse(raw) as CollabCommand;
    } catch {
      continue;
    }
    if ('deadline' in command && command.deadline && Date.now() > command.deadline) continue;
    await handle(command).catch((error: unknown) => console.error(`Commande ${command.op} en échec:`, error));
  }
}
void consumeWrites();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true;
    queueReader.disconnect();
    void server.destroy().finally(() => process.exit(0));
  });
}

await server.listen();
console.log(`Collab Andal sur ws://127.0.0.1:${server.configuration.port}`);
