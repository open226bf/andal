/**
 * Lecture d'une spec OpenAPI 3 (déjà analysée, YAML ou JSON): liste des
 * opérations et opération normalisée pour le bloc OpenAPI d'une page.
 * Seules les références locales (`#/components/…`) sont suivies.
 */
import type { ApiField, ApiOperation } from './index.js';

type Json = Record<string, unknown>;

export interface SpecOperation {
  /** « POST /oauth/token »: l'identifiant de l'opération dans la spec. */
  key: string;
  method: ApiOperation['method'];
  path: string;
  summary: string;
  tags: string[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Message d'erreur si le document n'est pas une spec OpenAPI 3 exploitable, sinon null. */
export function checkSpec(doc: unknown): string | null {
  if (!isObject(doc)) return "Le fichier n'est pas un document YAML ou JSON.";
  if (typeof doc.swagger === 'string') return 'Swagger 2 n’est pas pris en charge: convertissez la spec en OpenAPI 3.';
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.')) return 'Le document n’a pas de champ « openapi: 3.x ».';
  if (!isObject(doc.info) || typeof doc.info.title !== 'string') return 'Le document n’a pas de titre (info.title).';
  if (!isObject(doc.paths)) return 'Le document n’a pas de chemins (paths).';
  return null;
}

export function specInfo(doc: unknown): { title: string; version: string } {
  const info = isObject(doc) && isObject(doc.info) ? doc.info : {};
  return { title: typeof info.title === 'string' ? info.title : 'API', version: typeof info.version === 'string' ? info.version : '' };
}

/** Suit une référence locale; s'arrête après 10 sauts (références circulaires). */
function resolve(doc: unknown, value: unknown, depth = 0): unknown {
  if (!isObject(value) || typeof value.$ref !== 'string' || depth > 10) return value;
  const ref = value.$ref;
  if (!ref.startsWith('#/')) return {};
  let target: unknown = doc;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    target = isObject(target) ? target[key] : undefined;
  }
  return resolve(doc, target, depth + 1);
}

function refName(value: unknown): string | null {
  return isObject(value) && typeof value.$ref === 'string' ? (value.$ref.split('/').pop() ?? null) : null;
}

/** « string », « integer (int64) », « array<Paiement> », « "eur" | "xof" ». */
function typeLabel(doc: unknown, raw: unknown): string {
  const named = refName(raw);
  const schema = resolve(doc, raw);
  if (!isObject(schema)) return named ?? 'any';
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 6) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (schema.type === 'array') return `array<${typeLabel(doc, schema.items)}>`;
  if (named && (schema.type === 'object' || schema.properties)) return named;
  const type = Array.isArray(schema.type) ? schema.type.filter((t) => t !== 'null').join(' | ') : typeof schema.type === 'string' ? schema.type : named ?? 'object';
  return typeof schema.format === 'string' ? `${type} (${schema.format})` : type;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Les champs d'un schéma objet (allOf fusionné), dans l'ordre de la spec. */
function fields(doc: unknown, raw: unknown): ApiField[] {
  const schema = resolve(doc, raw);
  if (!isObject(schema)) return [];
  if (Array.isArray(schema.allOf)) return schema.allOf.flatMap((part) => fields(doc, part));
  if (!isObject(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : []);
  return Object.entries(schema.properties).map(([name, prop]) => {
    const resolved = resolve(doc, prop);
    return { name, type: typeLabel(doc, prop), required: required.has(name), description: text(isObject(resolved) ? resolved.description : '') };
  });
}

/** Le premier contenu JSON (ou à défaut le premier tout court) d'une requête ou d'une réponse. */
function pickContent(content: unknown): [string, Json] | null {
  if (!isObject(content)) return null;
  const types = Object.keys(content);
  const type = types.find((t) => t.includes('json')) ?? types[0];
  return type && isObject(content[type]) ? [type, content[type]] : null;
}

function example(doc: unknown, media: Json): string | undefined {
  let value: unknown = media.example;
  if (value === undefined && isObject(media.examples)) {
    const first = resolve(doc, Object.values(media.examples)[0]);
    if (isObject(first)) value = first.value;
  }
  if (value === undefined) {
    const schema = resolve(doc, media.schema);
    if (isObject(schema)) value = schema.example;
  }
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function listOperations(doc: unknown): SpecOperation[] {
  if (!isObject(doc) || !isObject(doc.paths)) return [];
  const out: SpecOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    const resolved = resolve(doc, item);
    if (!isObject(resolved)) continue;
    for (const method of METHODS) {
      const op = resolved[method];
      if (!isObject(op)) continue;
      const upper = method.toUpperCase() as ApiOperation['method'];
      out.push({
        key: `${upper} ${path}`,
        method: upper,
        path,
        summary: text(op.summary) || text(op.operationId) || '',
        tags: Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === 'string') : [],
      });
    }
  }
  return out;
}

/** L'opération « POST /oauth/token » telle que l'affiche le bloc OpenAPI, ou null si elle n'existe pas. */
export function operationFromSpec(doc: unknown, key: string): ApiOperation | null {
  const match = /^(GET|POST|PUT|PATCH|DELETE) (\/.*)$/.exec(key.trim());
  if (!match || !isObject(doc) || !isObject(doc.paths)) return null;
  const [, method, path] = match as unknown as [string, ApiOperation['method'], string];
  const item = resolve(doc, doc.paths[path]);
  const op = isObject(item) ? item[method.toLowerCase()] : null;
  if (!isObject(item) || !isObject(op)) return null;

  const parameters = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]
    .map((p) => resolve(doc, p))
    .filter(isObject)
    .map((p) => ({ name: String(p.name ?? ''), in: String(p.in ?? 'query'), type: typeLabel(doc, p.schema), required: p.required === true, description: text(p.description) }));

  const body = resolve(doc, op.requestBody);
  const media = isObject(body) ? pickContent(body.content) : null;

  const responses = isObject(op.responses)
    ? Object.entries(op.responses)
        .filter(([status]) => /^\d{3}$/.test(status))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([status, raw]) => {
          const response = resolve(doc, raw);
          const content = isObject(response) ? pickContent(response.content) : null;
          return { status: Number(status), description: text(isObject(response) ? response.description : ''), example: content ? example(doc, content[1]) : undefined };
        })
    : [];

  return {
    method,
    path,
    summary: text(op.summary) || text(op.operationId),
    contentType: media?.[0],
    requestBody: media ? fields(doc, media[1].schema) : [],
    parameters,
    responses,
  };
}
