import { createHash } from 'node:crypto';

/** JSON aux clés triées: deux publications identiques à l'ordre des clés près ont la même empreinte. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Empreinte SHA-256 d'une spec OpenAPI analysée. */
export function specHash(doc: unknown): string {
  return createHash('sha256').update(stable(doc)).digest('hex');
}
