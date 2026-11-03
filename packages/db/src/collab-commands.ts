/**
 * Commandes de l'API vers le serveur collab, publiées sur Valkey.
 * Celles qui attendent une réponse la reçoivent dans une liste dédiée (BLPOP).
 */

export const COLLAB_CHANNEL = 'andal:collab';

export type CollabCommand =
  | { op: 'anchor'; requestId: string; pageId: string; threadId: string; from: string; to: string }
  | { op: 'unanchor'; requestId: string; pageId: string; threadId: string }
  | { op: 'threads'; requestId: string; pageId: string }
  | { op: 'kick'; requestId: string; userId: string }
  /** Les droits ont changé: revérifier chaque connexion ouverte (lecture seule, ou fermeture). */
  | { op: 'access'; requestId: string }
  /** De nouvelles notifications attendent ces comptes. */
  | { op: 'notify'; requestId: string; userIds: string[] }
  /** Le sommaire d'un volume a changé (page créée, renommée, réordonnée). */
  | { op: 'tree'; requestId: string }
  /** Remettre le contenu d'une ancienne version dans le document vivant, au nom de `userId`. Réponse: 'ok', 'same' ou 'invalid'. */
  | { op: 'restore'; requestId: string; pageId: string; versionId: string; userId: string };

/** Réponses possibles d'une commande ancrée: 'ok', 'invalid' (positions inutilisables) ou 'error'. */
export function collabReplyKey(requestId: string): string {
  return `andal:collab:reply:${requestId}`;
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
