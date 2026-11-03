import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, Storage, type Database } from '@andal/db';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { config } from './env.js';

export const DB = Symbol('DB');
export const VALKEY = Symbol('VALKEY');
/** File BullMQ partagée avec le worker (indexation, emails de notification). */
export const QUEUE = Symbol('QUEUE');
/** Stockage S3 des fichiers envoyés; null si S3_BUCKET n'est pas renseigné. */
export const STORAGE = Symbol('STORAGE');

async function createStorage(): Promise<Storage | null> {
  if (!config.storage) return null;
  const storage = new Storage(config.storage);
  try {
    await storage.ensureBucket();
  } catch (error) {
    // Le stockage peut démarrer après l'API: l'envoi échouera proprement d'ici là.
    console.warn(`Stockage ${config.storage.bucket} injoignable au démarrage:`, error instanceof Error ? error.message : error);
  }
  return storage;
}

@Global()
@Module({
  providers: [
    { provide: DB, useFactory: () => createDb(config.databaseUrl) },
    { provide: VALKEY, useFactory: () => new Redis(config.valkeyUrl, { lazyConnect: false }) },
    { provide: QUEUE, useFactory: () => new Queue('andal', { connection: new Redis(config.valkeyUrl, { maxRetriesPerRequest: null }) }) },
    { provide: STORAGE, useFactory: createStorage },
  ],
  exports: [DB, VALKEY, QUEUE, STORAGE],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(STORAGE) private readonly storage: Storage | null,
  ) {}

  async onApplicationShutdown() {
    this.storage?.destroy();
    await Promise.allSettled([this.db.destroy(), this.valkey.quit(), this.queue.close()]);
  }
}
