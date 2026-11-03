import { CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { Kysely } from 'kysely';
import type { Database } from './schema.js';

/**
 * Stockage des fichiers envoyés: tout service compatible S3 (RustFS en dev,
 * MinIO, Garage, S3, R2…). Les droits ne passent jamais par le stockage:
 * l'API vérifie la lecture de la page, puis relaie l'objet.
 */
export interface StorageConfig {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** Null tant que S3_BUCKET n'est pas renseigné: l'envoi de fichiers est alors désactivé. */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) return null;
  const accessKeyId = env.S3_ACCESS_KEY?.trim();
  const secretAccessKey = env.S3_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) throw new Error('S3_ACCESS_KEY et S3_SECRET_KEY sont requis avec S3_BUCKET.');
  return {
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    region: env.S3_REGION?.trim() || 'us-east-1',
    bucket,
    accessKeyId,
    secretAccessKey,
    // RustFS et MinIO servent les buckets dans le chemin, pas en sous-domaine.
    forcePathStyle: !['0', 'false', 'no'].includes(env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() ?? 'true'),
  };
}

export class Storage {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  /** Crée le bucket s'il n'existe pas encore (premier démarrage). */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Readable> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return object.Body as Readable;
  }

  async remove(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}

/**
 * Efface du stockage les objets dont la pièce jointe a disparu de la base
 * (page purgée, volume supprimé). Renvoie le nombre d'objets effacés.
 */
export async function emptyStorageTrash(db: Kysely<Database>, storage: Storage): Promise<number> {
  const rows = await db.selectFrom('storage_trash').select('storage_key').orderBy('created_at').limit(5000).execute();
  if (rows.length === 0) return 0;
  const keys = rows.map((r) => r.storage_key);
  await storage.remove(keys);
  await db.deleteFrom('storage_trash').where('storage_key', 'in', keys).execute();
  return keys.length;
}
