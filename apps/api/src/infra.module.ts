import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Database } from '@andal/db';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { config } from './env.js';

export const DB = Symbol('DB');
export const VALKEY = Symbol('VALKEY');
/** File BullMQ partagée avec le worker (indexation, emails de notification). */
export const QUEUE = Symbol('QUEUE');

@Global()
@Module({
  providers: [
    { provide: DB, useFactory: () => createDb(config.databaseUrl) },
    { provide: VALKEY, useFactory: () => new Redis(config.valkeyUrl, { lazyConnect: false }) },
    { provide: QUEUE, useFactory: () => new Queue('andal', { connection: new Redis(config.valkeyUrl, { maxRetriesPerRequest: null }) }) },
  ],
  exports: [DB, VALKEY, QUEUE],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled([this.db.destroy(), this.valkey.quit(), this.queue.close()]);
  }
}
