import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '@andal/db';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { Public } from './auth/auth.guard.js';
import { DB, VALKEY } from './infra.module.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  @Public()
  @Get()
  async check() {
    try {
      await sql`select 1`.execute(this.db);
      await this.valkey.ping();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded' });
    }
  }
}
