import { Inject, Injectable } from '@nestjs/common';
import type { WebhookEventJob } from '@andal/db';
import type { Queue } from 'bullmq';
import { QUEUE } from '../infra.module.js';

/** Événements pour les intégrations: mis en file, le worker trouve les abonnés et envoie. */
@Injectable()
export class EventsService {
  constructor(@Inject(QUEUE) private readonly queue: Queue) {}

  async emit(job: WebhookEventJob): Promise<void> {
    try {
      await this.queue.add('webhook.event', job, { removeOnComplete: 100, removeOnFail: 100 });
    } catch (error) {
      // Une file indisponible ne doit pas faire échouer l'action de la personne.
      console.error(`Événement ${job.event} non mis en file:`, error);
    }
  }
}
