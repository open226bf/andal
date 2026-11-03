/**
 * Markdown ⇄ document Andal, pour l'API de contenu et la synchro Git.
 *
 * Le Markdown est celui de GitHub (tableaux, cases à cocher, barré), plus trois
 * conventions pour les blocs d'Andal:
 *   ```mermaid title="Légende"           un diagramme
 *   ```openapi  (spec: … / operation: …)  une opération d'une spec du volume
 *   > [!NOTE] Titre                       un encadré
 * Les ancres de commentaires ne passent pas en Markdown.
 */
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { fileUrl, type JSONContent } from './index.js';

type Mark = NonNullable<JSONContent['marks']>[number];

const FILE_URL = /^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/* ---------- Document → Markdown ---------- */

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code'];
const markRank = (mark: Mark) => {
  const i = MARK_ORDER.indexOf(mark.type);
  return i === -1 ? 99 : i;
};

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<]|~~)/g, '\\$1');
}

function openMark(mark: Mark): string {
  switch (mark.type) {
    case 'bold':
      return '**';
    case 'italic':
      return '_';
    case 'strike':
      return '~~';
    case 'code':
      return '`';
    case 'link':
      return '[';
    default:
      return '';
  }
}

function closeMark(mark: Mark): string {
  if (mark.type === 'link') return `](${String(mark.attrs?.href ?? '')})`;
  return openMark(mark);
}

const sameMark = (a: Mark, b: Mark) => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});

/** Le texte d'un bloc, marques fermées et rouvertes au bon moment (pas de `**a****b**`). */
function inline(nodes: JSONContent[] | undefined): string {
  let out = '';
  const open: Mark[] = [];
  const closeFrom = (index: number) => {
    while (open.length > index) out += closeMark(open.pop()!);
  };
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      closeFrom(0);
      out += '\\\n';
      continue;
    }
    if (node.type !== 'text') continue;
    const marks = (node.marks ?? []).filter((m) => MARK_ORDER.includes(m.type)).sort((a, b) => markRank(a) - markRank(b));
    let keep = 0;
    while (keep < open.length && keep < marks.length && sameMark(open[keep]!, marks[keep]!)) keep++;
    closeFrom(keep);
    for (const mark of marks.slice(keep)) {
      out += openMark(mark);
      open.push(mark);
    }
    const code = marks.some((m) => m.type === 'code');
    out += code ? (node.text ?? '').replaceAll('`', 'ˋ') : escapeText(node.text ?? '');
  }
  closeFrom(0);
  return out;
}

const indent = (text: string, prefix: string, first = prefix) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 ? first : line ? prefix : '') + line)
    .join('\n');

function quoteAttr(value: unknown): string {
  return String(value ?? '').replaceAll('"', '”');
}

function block(node: JSONContent): string {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph':
      return inline(node.content);
    case 'heading':
      return `${attrs.level === 3 ? '###' : '##'} ${inline(node.content)}`;
    case 'blockquote':
      return indent(blocks(node.content), '> ').replace(/^> $/gm, '>');
    case 'callout': {
      const tone = attrs.tone === 'warning' ? 'WARNING' : attrs.tone === 'tip' ? 'TIP' : 'NOTE';
      return indent(`[!${tone}] ${String(attrs.title ?? '')}`.trimEnd() + '\n' + blocks(node.content), '> ').replace(/^> $/gm, '>');
    }
    case 'bulletList':
      return (node.content ?? []).map((item) => indent(blocks(item.content), '  ', '- ')).join('\n');
    case 'orderedList': {
      const start = Number(attrs.start ?? 1);
      return (node.content ?? []).map((item, i) => indent(blocks(item.content), '   ', `${start + i}. `)).join('\n');
    }
    case 'taskList':
      return (node.content ?? []).map((item) => indent(blocks(item.content), '  ', `- [${item.attrs?.checked ? 'x' : ' '}] `)).join('\n');
    case 'codeBlock':
      return fence(String(attrs.language ?? ''), textOf(node));
    case 'mermaid':
      return fence(attrs.caption ? `mermaid title="${quoteAttr(attrs.caption)}"` : 'mermaid', String(attrs.source ?? ''));
    case 'openapi': {
      const lines = [`spec: ${String(attrs.specFile ?? '')}`, `operation: ${String(attrs.operationKey ?? (attrs.operation as { method?: string; path?: string } | null)?.method + ' ' + (attrs.operation as { path?: string } | null)?.path)}`];
      return fence(attrs.caption ? `openapi title="${quoteAttr(attrs.caption)}"` : 'openapi', lines.join('\n'));
    }
    case 'horizontalRule':
      return '---';
    case 'image': {
      const url = fileUrl(String(attrs.fileId ?? ''));
      return `![${escapeText(String(attrs.alt ?? ''))}](${url}${attrs.caption ? ` "${quoteAttr(attrs.caption)}"` : ''})`;
    }
    case 'drawio':
      return attrs.src ? `![${escapeText(String(attrs.alt ?? ''))}](${String(attrs.src)}${attrs.caption ? ` "${quoteAttr(attrs.caption)}"` : ''})` : '';
    case 'attachment':
      return `[${escapeText(String(attrs.name ?? 'fichier'))}](${fileUrl(String(attrs.fileId ?? ''))})`;
    case 'table':
      return table(node);
    default:
      return blocks(node.content);
  }
}

function textOf(node: JSONContent): string {
  return (node.content ?? []).map((c) => c.text ?? '').join('');
}

function fence(info: string, body: string): string {
  const ticks = body.includes('```') ? '````' : '```';
  return `${ticks}${info}\n${body}\n${ticks}`;
}

function cellText(cell: JSONContent): string {
  return (cell.content ?? [])
    .map((b) => (b.type === 'paragraph' || b.type === 'heading' ? inline(b.content) : blocks([b]).replace(/\n/g, ' ')))
    .join('<br>')
    .replace(/\|/g, '\\|');
}

function table(node: JSONContent): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map(cellText));
  const width = Math.max(1, ...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill('')];
  const firstIsHeader = (node.content?.[0]?.content ?? []).every((c) => c.type === 'tableHeader');
  const head = firstIsHeader ? pad(rows.shift() ?? []) : Array<string>(width).fill('');
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(head), line(Array<string>(width).fill('---')), ...rows.map((r) => line(pad(r)))].join('\n');
}

function blocks(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map(block)
    .filter((b) => b !== '')
    .join('\n\n');
}

export function toMarkdown(doc: JSONContent): string {
  return `${blocks(doc.content)}\n`;
}

/* ---------- Markdown → document ---------- */

const md = new MarkdownIt('default', { html: false, linkify: false, breaks: false });

/** `mermaid title="Légende"`: le langage, puis l'attribut title s'il y en a un. */
function parseInfo(info: string): { lang: string; title: string | null } {
  const lang = info.trim().split(/\s+/)[0] ?? '';
  const title = /title="([^"]*)"/.exec(info)?.[1] ?? null;
  return { lang, title };
}

function inlineNodes(tokens: Token[] | null): JSONContent[] {
  const out: JSONContent[] = [];
  const marks: Mark[] = [];
  const push = (text: string, extra: Mark[] = []) => {
    if (!text) return;
    const all = [...marks, ...extra];
    out.push(all.length ? { type: 'text', text, marks: all } : { type: 'text', text });
  };
  const pop = (type: string) => {
    const i = marks.map((m) => m.type).lastIndexOf(type);
    if (i !== -1) marks.splice(i, 1);
  };
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'text':
      case 'html_inline':
        push(token.content);
        break;
      case 'code_inline':
        push(token.content, [{ type: 'code' }]);
        break;
      case 'softbreak':
        push(' ');
        break;
      case 'hardbreak':
        out.push({ type: 'hardBreak' });
        break;
      case 'strong_open':
        marks.push({ type: 'bold' });
        break;
      case 'strong_close':
        pop('bold');
        break;
      case 'em_open':
        marks.push({ type: 'italic' });
        break;
      case 'em_close':
        pop('italic');
        break;
      case 's_open':
        marks.push({ type: 'strike' });
        break;
      case 's_close':
        pop('strike');
        break;
      case 'link_open': {
        const href = token.attrGet('href') ?? '';
        // Liens web, mail et pages d'Andal seulement: pas de javascript: ni de data:.
        if (/^(https?:|mailto:|\/)/i.test(href)) marks.push({ type: 'link', attrs: { href } });
        else marks.push({ type: 'none' });
        break;
      }
      case 'link_close': {
        const last = marks.map((m) => m.type).lastIndexOf('link');
        const none = marks.map((m) => m.type).lastIndexOf('none');
        marks.splice(Math.max(last, none), 1);
        break;
      }
      case 'image':
        // Dans le texte, une image devient son texte alternatif; en bloc, voir `paragraph`.
        push(token.content);
        break;
    }
  }
  // Ordre attendu par le schéma (code en dernier), et sans marque fictive.
  return out.map((n) => (n.marks ? { ...n, marks: n.marks.filter((m) => m.type !== 'none') } : n)).map((n) => (n.marks && n.marks.length === 0 ? { type: n.type, text: n.text } : n));
}

/** Un paragraphe fait d'une seule image ou d'un seul lien vers un fichier d'Andal devient un bloc. */
function standalone(inlineToken: Token): JSONContent | null {
  const children = (inlineToken.children ?? []).filter((t) => !(t.type === 'text' && t.content.trim() === ''));
  if (children.length === 1 && children[0]!.type === 'image') {
    const img = children[0]!;
    const id = FILE_URL.exec(img.attrGet('src') ?? '')?.[1];
    if (id) return { type: 'image', attrs: { fileId: id, alt: img.content || '', caption: img.attrGet('title') || null } };
    return null;
  }
  if (children.length === 3 && children[0]!.type === 'link_open' && children[2]!.type === 'link_close' && children[1]!.type === 'text') {
    const id = FILE_URL.exec(children[0]!.attrGet('href') ?? '')?.[1];
    if (id) return { type: 'attachment', attrs: { fileId: id, name: children[1]!.content, size: null, contentType: null } };
  }
  return null;
}

const TASK = /^\[([ xX])\]\s+/;

interface Frame {
  node: JSONContent;
  close: string;
}

export function fromMarkdown(source: string): JSONContent {
  const tokens = md.parse(source, {});
  const root: JSONContent = { type: 'doc', content: [] };
  const stack: Frame[] = [{ node: root, close: '' }];
  const top = () => stack[stack.length - 1]!.node;
  const append = (node: JSONContent) => {
    const parent = top();
    (parent.content ??= []).push(node);
  };
  const open = (node: JSONContent, close: string) => {
    append(node);
    stack.push({ node, close });
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const frame = stack[stack.length - 1]!;
    if (token.type === frame.close) {
      stack.pop();
      continue;
    }
    switch (token.type) {
      case 'paragraph_open': {
        const inlineToken = tokens[i + 1]!;
        const special = standalone(inlineToken);
        if (special) {
          append(special);
          i += 2;
          break;
        }
        open({ type: 'paragraph' }, 'paragraph_close');
        break;
      }
      case 'heading_open': {
        const level = Number(token.tag.slice(1));
        open({ type: 'heading', attrs: { level: level <= 2 ? 2 : 3 } }, 'heading_close');
        break;
      }
      case 'inline': {
        const content = inlineNodes(token.children);
        if (content.length) top().content = [...(top().content ?? []), ...content];
        break;
      }
      case 'bullet_list_open': {
        // Toutes les entrées commencent par [ ] ou [x]: une liste de tâches.
        let depth = 0;
        let tasks = true;
        let items = 0;
        for (let j = i + 1; j < tokens.length; j++) {
          const t = tokens[j]!;
          if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') depth++;
          if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') {
            if (depth === 0) break;
            depth--;
          }
          if (depth === 0 && t.type === 'list_item_open') {
            items++;
            const first = tokens[j + 2];
            if (!(first?.type === 'inline' && TASK.test(first.content))) tasks = false;
          }
        }
        open({ type: tasks && items > 0 ? 'taskList' : 'bulletList' }, 'bullet_list_close');
        break;
      }
      case 'ordered_list_open': {
        const start = Number(token.attrGet('start') ?? 1);
        open({ type: 'orderedList', attrs: start === 1 ? {} : { start } }, 'ordered_list_close');
        break;
      }
      case 'list_item_open': {
        if (top().type === 'taskList') {
          const first = tokens[i + 2];
          const checked = /^\[[xX]\]/.test(first?.content ?? '');
          if (first?.type === 'inline' && first.children?.[0]?.type === 'text') {
            first.children[0].content = first.children[0].content.replace(TASK, '');
            first.content = first.content.replace(TASK, '');
          }
          open({ type: 'taskItem', attrs: { checked } }, 'list_item_close');
        } else {
          open({ type: 'listItem' }, 'list_item_close');
        }
        break;
      }
      case 'blockquote_open': {
        const first = tokens[i + 2];
        const alert = first?.type === 'inline' ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*)$/m.exec(first.content) : null;
        if (alert) {
          const [line, kind, title] = alert;
          first!.content = first!.content.slice(line.length).replace(/^\n/, '');
          first!.children = md.parseInline(first!.content, {})[0]?.children ?? [];
          const tone = kind === 'WARNING' || kind === 'CAUTION' ? 'warning' : kind === 'TIP' ? 'tip' : 'note';
          open({ type: 'callout', attrs: { tone, title: title?.trim() || (tone === 'warning' ? 'Attention' : tone === 'tip' ? 'Astuce' : 'À retenir') } }, 'blockquote_close');
        } else {
          open({ type: 'blockquote' }, 'blockquote_close');
        }
        break;
      }
      case 'fence':
      case 'code_block': {
        const { lang, title } = parseInfo(token.info ?? '');
        const body = token.content.replace(/\n$/, '');
        if (lang === 'mermaid') {
          append({ type: 'mermaid', attrs: { source: body, caption: title } });
        } else if (lang === 'openapi') {
          const spec = /^spec:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? '';
          const operation = /^operation:\s*(.+)$/m.exec(body)?.[1]?.trim().replace(/^(\w+)\s+/, (m, verb: string) => `${verb.toUpperCase()} `) ?? null;
          append({ type: 'openapi', attrs: { specId: null, operationKey: operation, specFile: spec, specVersion: null, operation: null, caption: title } });
        } else {
          append({ type: 'codeBlock', attrs: { language: lang || null }, content: body ? [{ type: 'text', text: body }] : [] });
        }
        break;
      }
      case 'hr':
        append({ type: 'horizontalRule' });
        break;
      case 'table_open':
        open({ type: 'table' }, 'table_close');
        break;
      case 'tr_open':
        open({ type: 'tableRow' }, 'tr_close');
        break;
      case 'th_open':
      case 'td_open': {
        const inlineToken = tokens[i + 1]!;
        // Cellule: un paragraphe par segment séparé par <br>.
        const parts = inlineToken.content.split(/<br\s*\/?>/i);
        const content = parts.map((part) => {
          const nodes = inlineNodes(md.parseInline(part.trim(), {})[0]?.children ?? null);
          return nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' };
        });
        append({ type: token.type === 'th_open' ? 'tableHeader' : 'tableCell', content });
        i += 2;
        break;
      }
      // thead, tbody: structure sans nœud.
    }
  }
  return normalize(root);
}

/** Ce que le schéma exige: un encadré ne contient que des paragraphes, un élément de liste commence par un paragraphe. */
function normalize(node: JSONContent): JSONContent {
  const content = node.content?.map(normalize);
  let next: JSONContent = content ? { ...node, content } : node;
  if (next.type === 'callout') {
    next = { ...next, content: (next.content ?? []).flatMap(asParagraphs) };
    if (!next.content?.length) next.content = [{ type: 'paragraph' }];
  }
  if ((next.type === 'listItem' || next.type === 'taskItem') && next.content?.[0]?.type !== 'paragraph') {
    next = { ...next, content: [{ type: 'paragraph' }, ...(next.content ?? [])] };
  }
  if (next.type === 'doc' && !next.content?.length) next = { ...next, content: [{ type: 'paragraph' }] };
  return next;
}

function asParagraphs(node: JSONContent): JSONContent[] {
  if (node.type === 'paragraph') return [node];
  if (node.type === 'heading') return [{ type: 'paragraph', content: node.content }];
  return (node.content ?? []).flatMap(asParagraphs);
}
