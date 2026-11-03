import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

export * from './schema.js';
export * from './access.js';
export * from './session.js';
export * from './password.js';
export * from './collab-commands.js';
export * from './profile.js';
export * from './mail.js';
export * from './mentions.js';
export * from './versions.js';
export * from './storage.js';
export { migrateToLatest } from './migrations.js';

export function createDb(connectionString: string, max = 10): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
  });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante: ${name}`);
  return value;
}
