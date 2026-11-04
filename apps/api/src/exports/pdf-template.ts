import { escapeHtml } from '@andal/editor/html';

/** Teinte de chaque toile, en clair: le PDF s'imprime toujours sur fond blanc. */
const CLOTHS: Record<string, { vol: string; deep: string; tint: string }> = {
  paiements: { vol: '#157F73', deep: '#0B5A51', tint: '#E2F3F0' },
  identite: { vol: '#5B4FD6', deep: '#3A2FA3', tint: '#ECEAFC' },
  donnees: { vol: '#F2B33D', deep: '#7A5408', tint: '#FDF3DD' },
  mobile: { vol: '#C2366A', deep: '#8F1E48', tint: '#FBE7EF' },
  plateforme: { vol: '#3B6FB6', deep: '#1E4377', tint: '#E6EEF8' },
  design: { vol: '#C93F28', deep: '#8E2A19', tint: '#FBE9E5' },
};

export interface PdfPage {
  locale: 'fr' | 'en';
  cloth: string;
  volume: string;
  number: string;
  title: string;
  summary: string | null;
  meta: string;
  body: string;
  mermaid: boolean;
}

/**
 * La page imprimée: même typographie que l'écran (Literata pour le texte,
 * Atkinson Hyperlegible pour les titres et l'interface), marges de livre.
 * `window.andalReady` dit au moteur PDF que diagrammes et polices sont prêts.
 */
export function pdfDocument(page: PdfPage): string {
  const c = CLOTHS[page.cloth] ?? CLOTHS.plateforme!;
  const script = page.mermaid
    ? `<script src="mermaid.min.js"></script>
<script>
(async () => {
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: '"Atkinson Hyperlegible Next", sans-serif', flowchart: { htmlLabels: false } });
    await mermaid.run({ querySelector: 'pre.mermaid', suppressErrors: true });
  } catch (e) {}
  await document.fonts.ready;
  window.andalReady = true;
})();
</script>`
    : `<script>document.fonts.ready.then(() => { window.andalReady = true; });</script>`;

  return `<!doctype html>
<html lang="${page.locale}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`${page.number} ${page.title}`)}</title>
<style>
@font-face { font-family: "Literata"; src: url("literata-latin-opsz-normal.woff2") format("woff2"); font-weight: 200 900; font-style: normal; }
@font-face { font-family: "Literata"; src: url("literata-latin-opsz-italic.woff2") format("woff2"); font-weight: 200 900; font-style: italic; }
@font-face { font-family: "Atkinson Hyperlegible Next"; src: url("atkinson-hyperlegible-next-latin-wght-normal.woff2") format("woff2"); font-weight: 200 800; }
@font-face { font-family: "Atkinson Hyperlegible Mono"; src: url("atkinson-hyperlegible-mono-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
:root { --ink: #1C2230; --ink-2: #4A5266; --ink-3: #646C80; --rule: #DDE1E8; --code: #F6F7FA; --vol: ${c.vol}; --deep: ${c.deep}; --tint: ${c.tint}; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); font: 400 10.5pt/1.6 "Literata", Georgia, serif; font-optical-sizing: auto; hyphens: auto; }
.running { display: flex; align-items: center; gap: 8px; margin-bottom: 18pt; font: 600 8pt "Atkinson Hyperlegible Next", sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
.running::before { content: ""; width: 10pt; height: 10pt; border-radius: 2pt; background: var(--vol); }
h1 { margin: 0 0 6pt; font: 700 22pt/1.2 "Atkinson Hyperlegible Next", sans-serif; letter-spacing: -.01em; }
h1 .num { margin-right: 8pt; color: var(--deep); font-variant-numeric: tabular-nums; }
.lede { margin: 0 0 6pt; font-size: 12pt; color: var(--ink-2); }
.meta { margin: 0 0 20pt; padding-bottom: 10pt; border-bottom: 1px solid var(--rule); font: 400 8.5pt "Atkinson Hyperlegible Next", sans-serif; color: var(--ink-3); }
h2 { margin: 18pt 0 6pt; font: 700 14pt/1.3 "Atkinson Hyperlegible Next", sans-serif; break-after: avoid; }
h3 { margin: 14pt 0 4pt; font: 700 11.5pt/1.35 "Atkinson Hyperlegible Next", sans-serif; break-after: avoid; }
h4 { margin: 10pt 0 4pt; font: 700 9pt "Atkinson Hyperlegible Next", sans-serif; color: var(--ink-2); }
p { margin: 0 0 8pt; orphans: 3; widows: 3; }
a { color: var(--deep); text-decoration: underline; text-decoration-thickness: .5pt; text-underline-offset: 1.5pt; }
code { font: 400 .88em "Atkinson Hyperlegible Mono", monospace; background: var(--code); border-radius: 3pt; padding: 0 2pt; }
ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li > p { margin-bottom: 3pt; }
ul.tasks { list-style: none; padding-left: 0; }
ul.tasks li { display: grid; grid-template-columns: 12pt 1fr; gap: 6pt; align-items: start; }
ul.tasks .box { width: 9pt; height: 9pt; margin-top: 3.5pt; border: 1pt solid var(--ink-3); border-radius: 2pt; }
ul.tasks li.done .box { background: var(--vol); border-color: var(--vol); }
ul.tasks li.done > div { color: var(--ink-3); text-decoration: line-through; }
blockquote { margin: 0 0 8pt; padding-left: 10pt; border-left: 2pt solid var(--rule); color: var(--ink-2); }
.callout { margin: 0 0 10pt; padding: 8pt 10pt; border-left: 3pt solid var(--vol); border-radius: 0 4pt 4pt 0; background: var(--tint); break-inside: avoid; }
.callout-warning { border-left-color: #D99A1E; background: #FFF6DB; }
.callout-tip { border-left-color: #1D7A46; background: #E3F3EA; }
.callout-title { margin-bottom: 3pt; font: 700 9.5pt "Atkinson Hyperlegible Next", sans-serif; }
.callout p:last-child { margin-bottom: 0; }
hr { margin: 14pt 0; border: 0; border-top: 1px solid var(--rule); }
figure { margin: 4pt 0 12pt; break-inside: avoid; }
figcaption { margin-top: 4pt; font: 400 8.5pt/1.4 "Atkinson Hyperlegible Next", sans-serif; color: var(--ink-2); }
.fignum { font-weight: 700; color: var(--deep); margin-right: 4pt; }
figure img { display: block; max-width: 100%; max-height: 190mm; margin: 0 auto; object-fit: contain; }
.diagram { padding: 8pt; border: 1px solid var(--rule); border-radius: 4pt; }
.diagram svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
pre.mermaid { margin: 0; white-space: pre-wrap; font: 400 8pt "Atkinson Hyperlegible Mono", monospace; color: var(--ink-3); }
.listing { position: relative; }
.listing pre { margin: 0; padding: 8pt 10pt; border: 1px solid var(--rule); border-radius: 4pt; background: var(--code); font: 400 8.5pt/1.5 "Atkinson Hyperlegible Mono", monospace; white-space: pre-wrap; word-break: break-word; }
.listing pre code { background: none; padding: 0; font-size: inherit; }
.lang { position: absolute; top: 4pt; right: 6pt; font: 600 7pt "Atkinson Hyperlegible Next", sans-serif; text-transform: uppercase; color: var(--ink-3); }
table { width: 100%; margin: 0 0 10pt; border-collapse: collapse; font-size: 9.5pt; }
table.grid th, table.grid td { padding: 4pt 6pt; border: 1px solid var(--rule); vertical-align: top; text-align: left; }
table.grid th { background: var(--code); font-family: "Atkinson Hyperlegible Next", sans-serif; font-weight: 700; }
table p { margin: 0; }
tr { break-inside: avoid; }
.api { border: 1px solid var(--rule); border-radius: 4pt; padding: 8pt 10pt; }
.api-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6pt; margin-bottom: 4pt; font-family: "Atkinson Hyperlegible Next", sans-serif; }
.verb { padding: 1pt 5pt; border-radius: 3pt; font: 700 8pt "Atkinson Hyperlegible Mono", monospace; color: #fff; background: #3B6FB6; }
.verb-get { background: #1D7A46; } .verb-post { background: #3B6FB6; } .verb-put, .verb-patch { background: #7A5408; } .verb-delete { background: #B3261E; }
.route { font-size: 9.5pt; background: none; }
.api-sum { color: var(--ink-2); font-size: 9.5pt; }
.api-ver { margin-left: auto; font-size: 8pt; color: var(--ink-3); }
.params td, .params th { padding: 3pt 6pt 3pt 0; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
.params th { font: 700 8pt "Atkinson Hyperlegible Next", sans-serif; color: var(--ink-3); }
.in, .req, .mime { margin-left: 4pt; font: 400 7.5pt "Atkinson Hyperlegible Next", sans-serif; color: var(--ink-3); }
.req { color: #B3261E; }
.type { font: 400 8.5pt "Atkinson Hyperlegible Mono", monospace; color: var(--ink-2); }
.resp { list-style: none; padding: 0; margin: 0; }
.resp li { padding: 3pt 0; border-bottom: 1px solid var(--rule); font-size: 9.5pt; }
.code-n { font: 700 8.5pt "Atkinson Hyperlegible Mono", monospace; margin-right: 4pt; color: #1D7A46; }
.resp li.err .code-n { color: #B3261E; }
.resp pre { margin: 4pt 0 0; padding: 6pt; background: var(--code); border-radius: 3pt; font: 400 8pt "Atkinson Hyperlegible Mono", monospace; white-space: pre-wrap; }
.attachment { padding: 6pt 8pt; border: 1px solid var(--rule); border-radius: 4pt; font-family: "Atkinson Hyperlegible Next", sans-serif; }
.attachment .label { font-weight: 700; color: var(--ink-3); margin-right: 4pt; }
.missing { padding: 10pt; border: 1px dashed var(--rule); border-radius: 4pt; color: var(--ink-3); font-size: 9pt; text-align: center; }
</style>
</head>
<body>
<div class="running">${escapeHtml(page.volume)}</div>
<h1><span class="num">${escapeHtml(page.number)}</span>${escapeHtml(page.title)}</h1>
${page.summary ? `<p class="lede">${escapeHtml(page.summary)}</p>` : ''}
<p class="meta">${escapeHtml(page.meta)}</p>
<main>
${page.body}
</main>
${script}
</body>
</html>`;
}

/** Pied de page du moteur PDF: numéro de page, en dehors du flux du document. */
export function pdfFooter(label: string): string {
  // Gabarit à part, sans les polices de la page: une ligne, alignée sur les marges du texte.
  return `<!doctype html><html><head><style>
html, body { margin: 0; padding: 0; }
.foot { box-sizing: border-box; width: 100%; padding: 0 0.75in; display: flex; justify-content: space-between; gap: 24px; font: 400 8pt Helvetica, Arial, sans-serif; color: #646C80; }
.foot span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style></head><body><div class="foot"><span>${escapeHtml(label)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div></body></html>`;
}
