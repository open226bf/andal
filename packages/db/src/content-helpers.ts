import { operationFromSpec, type JSONContent } from '@andal/editor';
import type { Kysely } from 'kysely';
import type { Database } from './schema.js';

/**
 * Relie les blocs OpenAPI écrits en Markdown (« spec: paiements ») à la spec
 * du volume qui porte ce nom, avec une copie de l'opération (dernière version).
 */
export async function linkSpecBlocks(db: Kysely<Database>, projectId: string, doc: JSONContent): Promise<JSONContent> {
  const names = new Set<string>();
  const collect = (node: JSONContent) => {
    if (node.type === 'openapi' && !node.attrs?.specId && typeof node.attrs?.specFile === 'string' && node.attrs.specFile) names.add(node.attrs.specFile);
    node.content?.forEach(collect);
  };
  collect(doc);
  if (names.size === 0) return doc;
  const specs = await db
    .selectFrom('api_specs as s')
    .innerJoin('api_spec_versions as v', 'v.spec_id', 's.id')
    .select(['s.id', 's.name', 'v.content', 'v.sequence'])
    .where('s.project_id', '=', projectId)
    .where('s.name', 'in', [...names])
    .orderBy('v.sequence', 'desc')
    .execute();
  const latest = new Map<string, (typeof specs)[number]>();
  for (const s of specs) if (!latest.has(s.name)) latest.set(s.name, s);
  const link = (node: JSONContent): JSONContent => {
    const content = node.content?.map(link);
    const next = content ? { ...node, content } : node;
    if (next.type !== 'openapi' || next.attrs?.specId) return next;
    const spec = latest.get(String(next.attrs?.specFile ?? ''));
    if (!spec) return next;
    const key = typeof next.attrs?.operationKey === 'string' ? next.attrs.operationKey : null;
    return { ...next, attrs: { ...next.attrs, specId: spec.id, operation: key ? operationFromSpec(spec.content, key) : null } };
  };
  return link(doc);
}

/** Signatures des formats d'image affichés dans la page. Le type annoncé ne suffit pas. */
export function sniffImage(head: Buffer, declared: string): string | null {
  const ascii = head.subarray(0, 16).toString('latin1');
  if (head[0] === 0x89 && ascii.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 12) === 'ftypavif' || ascii.slice(4, 12) === 'ftypavis') return 'image/avif';
  // SVG: affiché en <img> (aucun script ne s'y exécute) et servi sous CSP « sandbox ».
  if (declared === 'image/svg+xml' && /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head.subarray(0, 2048).toString('utf8').replace(/^﻿/, ''))) return 'image/svg+xml';
  return null;
}
