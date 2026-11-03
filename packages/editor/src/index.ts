/**
 * Schéma d'éditeur partagé par le navigateur, l'API, le serveur collab et le worker.
 *
 * Le schéma ProseMirror sert de liste blanche: un contenu qui ne le respecte pas
 * est refusé à l'enregistrement. Le navigateur étend ces nœuds avec des vues
 * React; le serveur s'en sert tel quel, sans DOM.
 */
import { Mark, Node, getSchema, type AnyExtension, type JSONContent } from '@tiptap/core';
import { Node as PMNode, type Schema } from '@tiptap/pm/model';
import Code from '@tiptap/extension-code';
import StarterKit from '@tiptap/starter-kit';

export type { JSONContent };

export interface ApiField {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface ApiResponse {
  status: number;
  description: string;
  example?: string;
}

export interface ApiOperation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  contentType?: string;
  requestBody?: ApiField[];
  responses: ApiResponse[];
}

/** Attribut stocké dans le JSON du nœud, jamais recopié dans le HTML. */
function dataAttr<T>(defaultValue: T) {
  return { default: defaultValue, rendered: false };
}

/** Diagramme Mermaid: la source est du texte, le rendu se fait côté client. */
export const MermaidBlock = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { source: dataAttr(''), caption: dataAttr<string | null>(null) };
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="mermaid"]' }];
  },
  renderHTML({ node }) {
    return ['figure', { 'data-type': 'mermaid' }, ['pre', {}, String(node.attrs.source)]];
  },
});

/** Référence d'une opération OpenAPI, extraite d'une spec publiée (par la CI par exemple). */
export const OpenApiBlock = Node.create({
  name: 'openapi',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      specFile: dataAttr(''),
      specVersion: dataAttr<string | null>(null),
      operation: dataAttr<ApiOperation | null>(null),
      caption: dataAttr<string | null>(null),
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="openapi"]' }];
  },
  renderHTML() {
    return ['figure', { 'data-type': 'openapi' }];
  },
});

/** Schéma draw.io: affiché en <img>, jamais en SVG inline, pour qu'aucun script ne s'exécute. */
export const DrawioBlock = Node.create({
  name: 'drawio',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: dataAttr(''),
      xml: dataAttr<string | null>(null),
      alt: dataAttr(''),
      caption: dataAttr<string | null>(null),
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="drawio"]' }];
  },
  renderHTML({ node }) {
    return ['figure', { 'data-type': 'drawio' }, ['img', { src: String(node.attrs.src), alt: String(node.attrs.alt) }]];
  },
});

/** Encadré « À retenir », « Attention » ou « Astuce ». */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      tone: { default: 'note', parseHTML: (el) => el.getAttribute('data-tone') ?? 'note' },
      title: { default: 'À retenir', parseHTML: (el) => el.getAttribute('data-title') ?? 'À retenir' },
    };
  },
  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]' }];
  },
  renderHTML({ node }) {
    return ['aside', { 'data-type': 'callout', 'data-tone': node.attrs.tone, 'data-title': node.attrs.title }, 0];
  },
});

/** Ancre d'un fil de commentaires; le fil lui-même vit en base. */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return {
      threadId: { default: null, parseHTML: (el) => el.getAttribute('data-thread'), renderHTML: (attrs) => ({ 'data-thread': attrs.threadId }) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-thread]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'comment-anchor' }, 0];
  },
});

/**
 * Code en ligne. Par défaut, il exclut toute autre marque; ici seulement la mise
 * en forme, pour qu'un commentaire ou un lien puisse couvrir `Authorization`.
 */
export const InlineCode = Code.extend({ excludes: 'bold italic strike underline' });

export const blockExtensions: AnyExtension[] = [MermaidBlock, OpenApiBlock, DrawioBlock, Callout, CommentMark, InlineCode];

/** Extensions du schéma, sans vue: à utiliser côté serveur. */
export function serverExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ heading: { levels: [2, 3] }, undoRedo: false, code: false }),
    ...blockExtensions,
  ];
}

let schemaCache: Schema | null = null;

export function andalSchema(): Schema {
  schemaCache ??= getSchema(serverExtensions());
  return schemaCache;
}

/** Vérifie qu'un document respecte le schéma; renvoie le message d'erreur sinon. */
export function validateDoc(json: JSONContent): string | null {
  try {
    PMNode.fromJSON(andalSchema(), json).check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Deux documents disent-ils la même chose ? Comparés une fois lus par le
 * schéma: un attribut nul absent du JSON vaut sa valeur par défaut. Sert à ne
 * pas compter comme une modification ce qui n'en est pas une.
 */
export function sameDoc(a: JSONContent, b: JSONContent): boolean {
  try {
    return PMNode.fromJSON(andalSchema(), a).eq(PMNode.fromJSON(andalSchema(), b));
  } catch {
    return false;
  }
}

const FIGURE_TYPES = new Set(['mermaid', 'drawio']);
const LISTING_TYPES = new Set(['openapi', 'codeBlock']);

/** Nombre de figures et de listings d'un document, pour numéroter « Figure 3.2 ». */
export function countNumbered(json: JSONContent): { figures: number; listings: number } {
  let figures = 0;
  let listings = 0;
  walk(json, (node) => {
    if (FIGURE_TYPES.has(node.type ?? '')) figures += 1;
    if (LISTING_TYPES.has(node.type ?? '')) listings += 1;
  });
  return { figures, listings };
}

/** Texte brut d'une page, pour l'index de recherche. */
export function extractText(json: JSONContent): string {
  const parts: string[] = [];
  walk(json, (node) => {
    if (node.text) parts.push(node.text);
    const attrs = node.attrs ?? {};
    if (typeof attrs.caption === 'string') parts.push(attrs.caption);
    if (node.type === 'callout' && typeof attrs.title === 'string') parts.push(attrs.title);
    if (node.type === 'openapi' && attrs.operation) {
      const op = attrs.operation as ApiOperation;
      parts.push(`${op.method} ${op.path} ${op.summary}`);
    }
  });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function walk(node: JSONContent, visit: (node: JSONContent) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}
