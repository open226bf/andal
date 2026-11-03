import type { Kysely } from 'kysely';
import type { Database } from './schema.js';

/** Au-delà de ce silence, la modification suivante ouvre une nouvelle version. */
export const VERSION_WINDOW_MS = 10 * 60 * 1000;

/**
 * À appeler après chaque modification enregistrée (contenu ou titre).
 *
 * Une version regroupe une séance de travail: tant que la dernière a été
 * touchée il y a moins de 10 minutes, elle est prolongée et ses auteurs
 * complétés; sinon une nouvelle commence et le numéro de la page avance.
 * Écrire à plusieurs donne donc une version à plusieurs noms, pas une par
 * enregistrement. `fresh` ouvre une nouvelle version quoi qu'il arrive
 * (restauration d'une ancienne version).
 */
export async function recordVersion(db: Kysely<Database>, pageId: string, userId: string | null, options: { fresh?: boolean } = {}): Promise<number> {
  const now = new Date();
  return db.transaction().execute(async (trx) => {
    const page = await trx.selectFrom('pages').select(['version', 'title', 'content']).where('id', '=', pageId).forUpdate().executeTakeFirstOrThrow();
    const last = await trx.selectFrom('page_versions').select(['id', 'version', 'authors', 'updated_at']).where('page_id', '=', pageId).orderBy('version', 'desc').limit(1).executeTakeFirst();
    const content = JSON.stringify(page.content);

    if (!options.fresh && last && last.version === page.version && now.getTime() - last.updated_at.getTime() < VERSION_WINDOW_MS) {
      const authors = userId && !last.authors.includes(userId) ? [...last.authors, userId] : last.authors;
      await trx.updateTable('page_versions').set({ title: page.title, content, authors: JSON.stringify(authors), updated_at: now }).where('id', '=', last.id).execute();
      return page.version;
    }

    const version = Math.max(last?.version ?? 0, page.version) + 1;
    await trx.updateTable('pages').set({ version }).where('id', '=', pageId).execute();
    await trx
      .insertInto('page_versions')
      .values({ page_id: pageId, version, title: page.title, content, authors: JSON.stringify(userId ? [userId] : []), created_at: now, updated_at: now })
      .execute();
    return version;
  });
}
