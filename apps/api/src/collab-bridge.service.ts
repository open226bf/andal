import { Inject, Injectable } from '@nestjs/common';
import { COLLAB_CHANNEL, collabReplyKey, type CollabCommand } from '@andal/db';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { VALKEY } from './infra.module.js';

/**
 * Passerelle vers le serveur collab, par Valkey.
 *
 * L'ancre d'un commentaire est une marque dans le document Yjs. Un commentateur
 * n'a pas le droit d'écrire dans le document: c'est donc le serveur collab qui
 * pose la marque, à la demande de l'API, une fois les droits vérifiés ici.
 */
@Injectable()
export class CollabBridgeService {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  /** Envoie une commande et attend la réponse du serveur collab. 'timeout' s'il ne répond pas. */
  private async request(command: CollabCommand, timeoutSeconds = 5): Promise<string> {
    // BLPOP bloque sa connexion: une connexion dédiée par requête.
    const waiter = this.valkey.duplicate();
    try {
      await this.valkey.publish(COLLAB_CHANNEL, JSON.stringify(command));
      const reply = await waiter.blpop(collabReplyKey(command.requestId), timeoutSeconds);
      return reply?.[1] ?? 'timeout';
    } finally {
      waiter.disconnect();
    }
  }

  /** Pose l'ancre du fil entre deux positions relatives Yjs (encodées en base64). */
  anchor(pageId: string, threadId: string, from: string, to: string): Promise<string> {
    return this.request({ op: 'anchor', requestId: randomUUID(), pageId, threadId, from, to });
  }

  /** Remet une ancienne version dans le document vivant: 'ok', 'same' (rien à changer), 'invalid' ou 'timeout'. */
  restore(pageId: string, versionId: string, userId: string): Promise<string> {
    return this.request({ op: 'restore', requestId: randomUUID(), pageId, versionId, userId });
  }

  /** Remplace le contenu d'une page (écriture par l'API): 'ok', 'same', 'invalid' ou 'timeout'. */
  replace(pageId: string, content: unknown, userId: string): Promise<string> {
    return this.request({ op: 'replace', requestId: randomUUID(), pageId, content, userId }, 10);
  }

  /** Retire l'ancre d'un fil supprimé. */
  unanchor(pageId: string, threadId: string): Promise<string> {
    return this.request({ op: 'unanchor', requestId: randomUUID(), pageId, threadId });
  }

  /** Prévient les lecteurs de la page que les fils ont changé (réponse, résolution…). */
  async notifyThreads(pageId: string): Promise<void> {
    await this.valkey.publish(COLLAB_CHANNEL, JSON.stringify({ op: 'threads', requestId: randomUUID(), pageId } satisfies CollabCommand));
  }

  /** Coupe les connexions temps réel d'un compte (désactivation). */
  async kick(userId: string): Promise<void> {
    await this.valkey.publish(COLLAB_CHANNEL, JSON.stringify({ op: 'kick', requestId: randomUUID(), userId } satisfies CollabCommand));
  }

  /**
   * Des droits ont changé (volume, restriction, groupe): le serveur collab
   * revérifie chaque connexion ouverte, et les navigateurs relisent leur page.
   */
  async accessChanged(): Promise<void> {
    await this.valkey.publish(COLLAB_CHANNEL, JSON.stringify({ op: 'access', requestId: randomUUID() } satisfies CollabCommand));
  }

  /** Un sommaire a changé: les navigateurs relisent sommaire et numéros. */
  async treeChanged(): Promise<void> {
    await this.valkey.publish(COLLAB_CHANNEL, JSON.stringify({ op: 'tree', requestId: randomUUID() } satisfies CollabCommand));
  }

  /** De nouvelles notifications attendent ces comptes. */
  async notify(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.valkey.publish(COLLAB_CHANNEL, JSON.stringify({ op: 'notify', requestId: randomUUID(), userIds } satisfies CollabCommand));
  }
}
