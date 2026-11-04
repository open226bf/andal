/**
 * HTML → Markdown d'Andal, pour l'import: export HTML de Confluence, pages HTML
 * quelconques. Le Markdown produit suit les conventions d'Andal (encadrés
 * `> [!NOTE]`, tableaux GFM, cases à cocher) et passe ensuite par le même
 * chemin qu'un import Markdown.
 */
import TurndownService from 'turndown';

export interface HtmlLinks {
  /** Adresse relative (encodée) d'un lien vers une autre page de l'export (.html), ou null: le texte reste sans lien. */
  page: (href: string) => string | null;
  /** Adresse relative (encodée) d'un fichier de l'export (image, pièce jointe), ou null s'il n'en est pas un. */
  asset: (href: string) => string | null;
}

const MACRO_TONES: Record<string, string> = { information: 'NOTE', info: 'NOTE', note: 'WARNING', warning: 'WARNING', tip: 'TIP', success: 'TIP', error: 'WARNING' };

/** Le plus proche ancêtre de cette balise (le DOM de domino n'a pas toujours closest()). */
export function ancestor(node: Node, tag: string): Element | null {
  for (let current = node.parentNode; current; current = current.parentNode) if (current.nodeName === tag) return current as Element;
  return null;
}

function classes(node: HTMLElement): string[] {
  return (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/** Langage d'un bloc de code Confluence: « brush: java; gutter: false » ou class="language-java". */
function codeLanguage(node: HTMLElement): string {
  const params = node.getAttribute('data-syntaxhighlighter-params') ?? node.getAttribute('class') ?? '';
  const brush = /brush:\s*([\w+#-]+)/.exec(params)?.[1] ?? /language-([\w+#-]+)/.exec(params)?.[1] ?? '';
  return ({ js: 'javascript', jscript: 'javascript', py: 'python', sh: 'bash', shell: 'bash', ps: 'powershell', text: '', plain: '' } as Record<string, string>)[brush] ?? brush;
}

function fence(lang: string, code: string): string {
  const ticks = code.includes('```') ? '````' : '```';
  return `\n\n${ticks}${lang}\n${code.replace(/\n+$/, '')}\n${ticks}\n\n`;
}

function quote(markdown: string): string {
  return markdown
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

export function htmlToMarkdown(html: string, links: HtmlLinks): string {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_', strongDelimiter: '**', hr: '---' });
  td.remove(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'form', 'button', 'input', 'select', 'textarea']);

  // Encadrés Confluence (info, note, warning, tip), et les « panel » à titre.
  td.addRule('confluence-macro', {
    filter: (node) => node.nodeName === 'DIV' && classes(node).some((c) => c.startsWith('confluence-information-macro-') && MACRO_TONES[c.slice('confluence-information-macro-'.length)] !== undefined),
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const kind = classes(el).map((c) => c.slice('confluence-information-macro-'.length)).find((k) => MACRO_TONES[k]) ?? 'information';
      const title = el.querySelector('.title')?.textContent?.trim() ?? '';
      const body = el.querySelector('.confluence-information-macro-body');
      const inner = body ? td.turndown(body.innerHTML) : '';
      return `\n\n${quote(`[!${MACRO_TONES[kind]}] ${title}`.trimEnd() + '\n' + inner)}\n\n`;
    },
  });
  td.addRule('confluence-panel', {
    filter: (node) => node.nodeName === 'DIV' && classes(node).includes('panel') && !classes(node).includes('code') && !classes(node).includes('preformatted'),
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const title = el.querySelector('.panelHeader')?.textContent?.trim() ?? '';
      const body = el.querySelector('.panelContent');
      const inner = td.turndown(body ? body.innerHTML : el.innerHTML);
      return `\n\n${quote(`[!NOTE] ${title}`.trimEnd() + '\n' + inner)}\n\n`;
    },
  });

  // Code: <pre class="syntaxhighlighter-pre" data-syntaxhighlighter-params="brush: java"> ou <pre><code class="language-…">.
  td.addRule('code', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const code = el.querySelector('code');
      return fence(codeLanguage(code ?? el), (code ?? el).textContent ?? '');
    },
  });

  // Listes de tâches de Confluence.
  td.addRule('tasks', {
    filter: (node) => node.nodeName === 'UL' && classes(node).includes('inline-task-list'),
    replacement: (_content, node) => {
      const items = Array.from((node as HTMLElement).childNodes).filter((c) => c.nodeName === 'LI') as HTMLElement[];
      return `\n\n${items.map((li) => `- [${classes(li).includes('checked') ? 'x' : ' '}] ${td.turndown(li.innerHTML).replace(/\n+/g, ' ').trim()}`).join('\n')}\n\n`;
    },
  });

  // Tableaux: toujours en GFM (le Markdown d'Andal n'accepte pas de HTML brut). Une cellule à plusieurs paragraphes garde ses sauts de ligne.
  td.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLElement).querySelectorAll('tr')).filter((tr) => ancestor(tr, 'TABLE') === node);
      const grid = rows.map((tr) =>
        (Array.from(tr.childNodes).filter((c) => c.nodeName === 'TH' || c.nodeName === 'TD') as HTMLElement[]).map((cell) => ({
          header: cell.nodeName === 'TH',
          text: td.turndown(cell.innerHTML).trim().replace(/\n+/g, '<br>').replace(/\|/g, '\\|'),
        })),
      );
      if (grid.length === 0) return '';
      const width = Math.max(1, ...grid.map((r) => r.length));
      const pad = (cells: string[]) => [...cells, ...Array<string>(width - cells.length).fill('')];
      const line = (cells: string[]) => `| ${pad(cells).join(' | ')} |`;
      const head = grid[0]!.every((c) => c.header) ? grid.shift()!.map((c) => c.text) : Array<string>(width).fill('');
      return `\n\n${[line(head), line(Array<string>(width).fill('---')), ...grid.map((r) => line(r.map((c) => c.text)))].join('\n')}\n\n`;
    },
  });

  td.addRule('image', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      // Émoticônes et icônes de l'interface Confluence: rien, ou leur texte.
      if (classes(el).includes('emoticon')) return el.getAttribute('alt') ?? '';
      const src = links.asset(el.getAttribute('data-image-src') ?? el.getAttribute('src') ?? '');
      if (!src) return '';
      const alt = (el.getAttribute('alt') ?? '').replace(/[[\]]/g, '');
      return `![${alt}](${src})`;
    },
  });

  td.addRule('link', {
    filter: (node) => node.nodeName === 'A' && node.getAttribute('href') !== null,
    replacement: (content, node) => {
      const href = (node as HTMLElement).getAttribute('href') ?? '';
      const text = content.trim() || href;
      if (/^(https?:|mailto:)/i.test(href)) return `[${text}](${href})`;
      const target = links.page(href) ?? links.asset(href);
      return target ? `[${text}](${target})` : content;
    },
  });

  return td
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Titre et contenu d'une page HTML: Confluence (#title-text, #main-content), sinon <main>, <article> ou <body>. */
export function pageParts(doc: Document): { title: string; body: string; space: string | null } {
  const raw = doc.querySelector('#title-text')?.textContent?.trim() || doc.querySelector('title')?.textContent?.trim() || doc.querySelector('h1')?.textContent?.trim() || '';
  // Confluence: « Espace : Titre de la page ».
  const split = /^(.+?) : (.+)$/.exec(raw);
  const main = doc.querySelector('#main-content') ?? doc.querySelector('main') ?? doc.querySelector('article') ?? doc.body;
  return { title: (split ? split[2]! : raw).replace(/\s+/g, ' ').slice(0, 200), body: main?.innerHTML ?? '', space: split ? split[1]! : null };
}
