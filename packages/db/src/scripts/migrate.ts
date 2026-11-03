import { createDb, migrateToLatest, requireEnv } from '../index.js';

const db = createDb(requireEnv('DATABASE_URL'), 1);
try {
  await migrateToLatest(db);
  console.log('Base à jour.');
} finally {
  await db.destroy();
}
