/**
 * Commandes de l'API (et du worker) vers le serveur collab, par Valkey.
 *
 * Deux voies, pour que plusieurs instances collab puissent tourner ensemble:
 * - les annonces (droits, sommaire, notifications, fils, coupure) sont publiées
 *   sur un canal: chaque instance s'occupe de ses propres connexions;
 * - les écritures (ancre, restauration, remplacement) passent par une file:
 *   une seule instance la prend, écrit, et répond dans une liste dédiée.
 */

export const COLLAB_CHANNEL = 'andal:collab';
export const COLLAB_QUEUE = 'andal:collab:queue';

/** `deadline` (ms): passé ce moment, plus personne n'attend la réponse; l'écriture est abandonnée. */
export type CollabCommand =
  | { op: 'anchor'; requestId: string; pageId: string; threadId: string; from: string; to: string; deadline?: number }
  | { op: 'unanchor'; requestId: string; pageId: string; threadId: string; deadline?: number }
  | { op: 'threads'; requestId: string; pageId: string }
  /** Couper les connexions temps réel d'un compte, ou d'une seule de ses sessions (empreinte). */
  | { op: 'kick'; requestId: string; userId: string; sessionHash?: string }
  /** Les droits ont changé: revérifier chaque connexion ouverte (lecture seule, ou fermeture). */
  | { op: 'access'; requestId: string }
  /** De nouvelles notifications attendent ces comptes. */
  | { op: 'notify'; requestId: string; userIds: string[] }
  /** Le sommaire d'un volume a changé (page créée, renommée, réordonnée). */
  | { op: 'tree'; requestId: string }
  /** Remettre le contenu d'une ancienne version dans le document vivant, au nom de `userId`. Réponse: 'ok', 'same' ou 'invalid'. */
  | { op: 'restore'; requestId: string; pageId: string; versionId: string; userId: string; deadline?: number }
  /** Remplacer le contenu (API, synchro Git), au nom de `userId` (null: la synchro, sans auteur). Réponse: 'ok', 'same' ou 'invalid'. */
  | { op: 'replace'; requestId: string; pageId: string; content: unknown; userId: string | null; deadline?: number };

/** Réponses possibles d'une commande ancrée: 'ok', 'invalid' (positions inutilisables) ou 'error'. */
export function collabReplyKey(requestId: string): string {
  return `andal:collab:reply:${requestId}`;
}

export type CollabWrite = Extract<CollabCommand, { op: 'anchor' | 'unanchor' | 'restore' | 'replace' }>;

const WRITES = new Set<CollabCommand['op']>(['anchor', 'unanchor', 'restore', 'replace']);

export function isCollabWrite(command: CollabCommand): command is CollabWrite {
  return WRITES.has(command.op);
}

/** Le strict nécessaire d'un client Valkey (ioredis), pour ne pas en dépendre ici. */
interface ValkeyClient {
  publish(channel: string, message: string): Promise<unknown>;
  lpush(key: string, value: string): Promise<unknown>;
  duplicate(): { blpop(key: string, timeout: number): Promise<[string, string] | null>; disconnect(): void };
}

/**
 * Une écriture dans le document vivant: mise en file, prise par une seule
 * instance collab, réponse attendue `timeoutSeconds`. Passé ce délai, la
 * commande est périmée: l'instance qui la trouverait plus tard l'ignore.
 */
export async function collabWrite(valkey: ValkeyClient, command: CollabWrite, timeoutSeconds = 5): Promise<string> {
  // BLPOP bloque sa connexion: une connexion dédiée par requête.
  const waiter = valkey.duplicate();
  try {
    await valkey.lpush(COLLAB_QUEUE, JSON.stringify({ ...command, deadline: Date.now() + timeoutSeconds * 1000 }));
    const reply = await waiter.blpop(collabReplyKey(command.requestId), timeoutSeconds);
    return reply?.[1] ?? 'timeout';
  } finally {
    waiter.disconnect();
  }
}

/** Une annonce à toutes les instances collab, sans réponse. */
export async function collabBroadcast(valkey: ValkeyClient, command: Exclude<CollabCommand, CollabWrite>): Promise<void> {
  await valkey.publish(COLLAB_CHANNEL, JSON.stringify(command));
}

/* Messages « stateless » envoyés aux navigateurs. Aucun ne porte de donnée: le client relit ce qui le concerne. */

/** Aux lecteurs d'une page: ses fils ont changé. */
export const THREADS_CHANGED = 'threads-changed';
/** À tous: des droits ont changé, la page, le sommaire et le partage sont à relire. */
export const ACCESS_CHANGED = 'access-changed';
/** À une personne: ses notifications ont changé. */
export const NOTIFICATIONS_CHANGED = 'notifications-changed';
/** À tous: un sommaire a changé, les numéros de section aussi. */
export const TREE_CHANGED = 'tree-changed';
/** Aux éditeurs d'une page: le serveur a refusé d'enregistrer son contenu (hors schéma). */
export const SAVE_REJECTED = 'save-rejected';
/** Aux éditeurs d'une page: l'enregistrement repasse, après un refus. */
export const SAVE_OK = 'save-ok';
