/**
 * Document Andal → HTML statique, pour l'export PDF.
 *
 * Tout le texte est échappé: rien du document ne devient du HTML actif. Les
 * images passent par `fileSrc` (le fichier joint à l'envoi au moteur PDF), les
 * diagrammes Mermaid restent en source dans un <pre class="mermaid">, rendu
 * par mermaid.js dans le navigateur qui imprime. Figures et listings sont
 * numérotés comme dans la page (« Figure 3.2 »).
 */
import type { ApiOperation, JSONContent } from './index.js';

export interface HtmlOptions {
  locale: 'fr' | 'en';
  /** Préfixe des numéros (le chapitre de la page) et figures ou listings des pages précédentes. */
  chapter?: string;
  figureOffset?: number;
  listingOffset?: number;
  /** Adresse d'une image envoyée; null: l'image est omise (texte alternatif à la place). */
  fileSrc: (fileId: string) => string | null;
  /** Adresse d'un lien interne (`/p/<id>`, `/api/files/<id>`); null: le texte reste, sans lien. */
  linkHref?: (href: string) => string | null;
}

const LABELS = {
  fr: { figure: 'Figure', listing: 'Listing', parameters: 'Paramètres', body: 'Corps de la requête', responses: 'Réponses', name: 'Nom', field: 'Champ', type: 'Type', description: 'Description', required: 'requis', file: 'Fichier joint' },
  en: { figure: 'Figure', listing: 'Listing', parameters: 'Parameters', body: 'Request body', responses: 'Responses', name: 'Name', field: 'Field', type: 'Type', description: 'Description', required: 'required', file: 'Attached file' },
};

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const SAFE_HREF = /^(https?:|mailto:)/i;

export function toHtml(doc: JSONContent, options: HtmlOptions): string {
  const labels = LABELS[options.locale];
  const prefix = options.chapter ? `${options.chapter}.` : '';
  let figures = options.figureOffset ?? 0;
  let listings = options.listingOffset ?? 0;

  const href = (raw: string): string | null => {
    if (SAFE_HREF.test(raw)) return raw;
    return options.linkHref ? options.linkHref(raw) : null;
  };

  const inline = (nodes: JSONContent[] | undefined): string =>
    (nodes ?? [])
      .map((node) => {
        if (node.type === 'hardBreak') return '<br>';
        if (node.type !== 'text') return '';
        let out = escapeHtml(node.text ?? '');
        // Le code au plus près du texte, le lien à l'extérieur.
        const marks = [...(node.marks ?? [])].sort((a, b) => (a.type === 'link' ? 1 : 0) - (b.type === 'link' ? 1 : 0));
        for (const mark of marks) {
          if (mark.type === 'bold') out = `<strong>${out}</strong>`;
          else if (mark.type === 'italic') out = `<em>${out}</em>`;
          else if (mark.type === 'strike') out = `<s>${out}</s>`;
          else if (mark.type === 'underline') out = `<u>${out}</u>`;
          else if (mark.type === 'code') out = `<code>${out}</code>`;
          else if (mark.type === 'link') {
            const target = href(String(mark.attrs?.href ?? ''));
            if (target) out = `<a href="${escapeHtml(target)}">${out}</a>`;
          }
        }
        return out;
      })
      .join('');

  const caption = (kind: 'figure' | 'listing', text: unknown) => {
    const n = kind === 'figure' ? ++figures : ++listings;
    const cap = typeof text === 'string' && text.trim() ? ` <span class="cap-text">${escapeHtml(text)}</span>` : '';
    return `<figcaption><span class="fignum">${labels[kind]} ${prefix}${n}</span>${cap}</figcaption>`;
  };

  const table = (op: ApiOperation, rows: ApiOperation['parameters'] | ApiOperation['requestBody'], first: string) => {
    const described = (rows ?? []).some((f) => f.description);
    const head = `<tr><th>${first}</th><th>${labels.type}</th>${described ? `<th>${labels.description}</th>` : ''}</tr>`;
    const body = (rows ?? [])
      .map((f) => {
        const where = 'in' in f ? ` <span class="in">${escapeHtml(String(f.in))}</span>` : '';
        const req = f.required ? ` <span class="req">${labels.required}</span>` : '';
        return `<tr><td><code>${escapeHtml(f.name)}</code>${where}${req}</td><td class="type">${escapeHtml(f.type)}</td>${described ? `<td>${escapeHtml(f.description)}</td>` : ''}</tr>`;
      })
      .join('');
    return `<table class="params"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  };

  const openapi = (attrs: Record<string, unknown>) => {
    const op = attrs.operation as ApiOperation | null;
    if (!op) return `<p class="missing">${escapeHtml(String(attrs.operationKey ?? attrs.specFile ?? 'OpenAPI'))}</p>`;
    const version = attrs.specVersion ? `<span class="api-ver">v${escapeHtml(String(attrs.specVersion))}</span>` : '';
    const parts = [`<div class="api-head"><span class="verb verb-${op.method.toLowerCase()}">${op.method}</span> <code class="route">${escapeHtml(op.path)}</code> <span class="api-sum">${escapeHtml(op.summary)}</span>${version}</div>`];
    if (op.parameters?.length) parts.push(`<h4>${labels.parameters}</h4>${table(op, op.parameters, labels.name)}`);
    if (op.requestBody?.length) parts.push(`<h4>${labels.body}${op.contentType ? ` <span class="mime">${escapeHtml(op.contentType)}</span>` : ''}</h4>${table(op, op.requestBody, labels.field)}`);
    if (op.responses.length) {
      const items = op.responses
        .map((r) => `<li class="${r.status < 400 ? 'ok' : 'err'}"><span class="code-n">${r.status}</span> ${escapeHtml(r.description)}${r.example ? `<pre>${escapeHtml(r.example)}</pre>` : ''}</li>`)
        .join('');
      parts.push(`<h4>${labels.responses}</h4><ul class="resp">${items}</ul>`);
    }
    return `<div class="api">${parts.join('')}</div>`;
  };

  const block = (node: JSONContent): string => {
    const attrs = node.attrs ?? {};
    switch (node.type) {
      case 'paragraph':
        return `<p>${inline(node.content)}</p>`;
      case 'heading':
        return attrs.level === 3 ? `<h3>${inline(node.content)}</h3>` : `<h2>${inline(node.content)}</h2>`;
      case 'blockquote':
        return `<blockquote>${blocks(node.content)}</blockquote>`;
      case 'callout': {
        const tone = attrs.tone === 'warning' || attrs.tone === 'tip' ? attrs.tone : 'note';
        const title = typeof attrs.title === 'string' && attrs.title ? `<p class="callout-title">${escapeHtml(attrs.title)}</p>` : '';
        return `<aside class="callout callout-${tone}">${title}${blocks(node.content)}</aside>`;
      }
      case 'bulletList':
        return `<ul>${(node.content ?? []).map((item) => `<li>${blocks(item.content)}</li>`).join('')}</ul>`;
      case 'orderedList': {
        const start = Number(attrs.start ?? 1);
        return `<ol${start !== 1 ? ` start="${start}"` : ''}>${(node.content ?? []).map((item) => `<li>${blocks(item.content)}</li>`).join('')}</ol>`;
      }
      case 'taskList':
        return `<ul class="tasks">${(node.content ?? []).map((item) => `<li class="${item.attrs?.checked ? 'done' : 'todo'}"><span class="box" aria-hidden="true"></span><div>${blocks(item.content)}</div></li>`).join('')}</ul>`;
      case 'codeBlock': {
        const code = (node.content ?? []).map((c) => c.text ?? '').join('');
        const lang = typeof attrs.language === 'string' && attrs.language ? `<span class="lang">${escapeHtml(attrs.language)}</span>` : '';
        return `<figure class="listing">${lang}<pre><code>${escapeHtml(code)}</code></pre>${caption('listing', null)}</figure>`;
      }
      case 'mermaid':
        return `<figure class="diagram"><pre class="mermaid">${escapeHtml(String(attrs.source ?? ''))}</pre>${caption('figure', attrs.caption)}</figure>`;
      case 'openapi':
        return `<figure class="listing">${openapi(attrs)}${caption('listing', attrs.caption)}</figure>`;
      case 'drawio': {
        const src = String(attrs.src ?? '');
        // Le rendu du schéma est une image en data: (SVG ou PNG), jamais du SVG inline.
        const alt = escapeHtml(String(attrs.alt ?? ''));
        const img = /^data:image\/(svg\+xml|png|jpeg|webp);/i.test(src) ? `<img src="${escapeHtml(src)}" alt="${alt}">` : `<p class="missing">${alt}</p>`;
        return `<figure class="diagram">${img}${caption('figure', attrs.caption)}</figure>`;
      }
      case 'image': {
        const src = options.fileSrc(String(attrs.fileId ?? ''));
        const alt = String(attrs.alt ?? '');
        const img = src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">` : `<p class="missing">${escapeHtml(alt)}</p>`;
        return `<figure class="image">${img}${caption('figure', attrs.caption)}</figure>`;
      }
      case 'attachment':
        return `<p class="attachment"><span class="label">${labels.file}</span> ${escapeHtml(String(attrs.name ?? ''))}</p>`;
      case 'horizontalRule':
        return '<hr>';
      case 'table': {
        const rows = (node.content ?? [])
          .map((row) => `<tr>${(row.content ?? []).map((cell) => {
            const tag = cell.type === 'tableHeader' ? 'th' : 'td';
            const span = [cell.attrs?.colspan > 1 ? ` colspan="${Number(cell.attrs?.colspan)}"` : '', cell.attrs?.rowspan > 1 ? ` rowspan="${Number(cell.attrs?.rowspan)}"` : ''].join('');
            return `<${tag}${span}>${blocks(cell.content)}</${tag}>`;
          }).join('')}</tr>`)
          .join('');
        return `<table class="grid"><tbody>${rows}</tbody></table>`;
      }
      default:
        return blocks(node.content);
    }
  };

  const blocks = (nodes: JSONContent[] | undefined): string => (nodes ?? []).map(block).join('\n');

  return blocks(doc.content);
}
