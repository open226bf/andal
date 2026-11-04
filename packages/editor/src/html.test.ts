import { describe, expect, it } from 'vitest';
import { toHtml } from './html.js';
import type { JSONContent } from './index.js';

const FILE = '0b7e6c1a-6a59-4b43-9d0f-7f8d1a2b3c4d';
const text = (value: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

describe('document → HTML (export PDF)', () => {
  it('échappe tout le texte et ne garde que les liens web', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        p(text('<script>alert(1)</script>')),
        p(text('piège', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]), text(' et '), text('site', [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b="2"' } }])),
        { type: 'mermaid', attrs: { source: 'graph TD; A-->B<img src=x onerror=alert(1)>' } },
      ],
    };
    const html = toHtml(doc, { locale: 'fr', fileSrc: () => null });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('piège');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"');
  });

  it('numérote figures et listings à la suite des pages précédentes du chapitre', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { fileId: FILE, alt: 'Schéma', caption: 'Vue générale' } },
        { type: 'codeBlock', attrs: { language: 'bash' }, content: [text('make')] },
        { type: 'mermaid', attrs: { source: 'graph TD; A-->B', caption: null } },
      ],
    };
    const html = toHtml(doc, { locale: 'fr', chapter: '3', figureOffset: 1, listingOffset: 4, fileSrc: (id) => `f-${id}.png` });
    expect(html).toContain('Figure 3.2</span> <span class="cap-text">Vue générale');
    expect(html).toContain('Listing 3.5');
    expect(html).toContain('Figure 3.3');
    expect(html).toContain(`src="f-${FILE}.png"`);
  });

  it('rend une opération OpenAPI depuis la copie gardée dans la page', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'openapi',
          attrs: {
            specVersion: '2.3',
            operation: { method: 'POST', path: '/v1/tokens', summary: 'Créer un jeton', parameters: [], requestBody: [{ name: 'scope', type: 'string', required: true, description: '' }], responses: [{ status: 201, description: 'Créé' }] },
          },
        },
      ],
    };
    const html = toHtml(doc, { locale: 'en', fileSrc: () => null });
    expect(html).toContain('<span class="verb verb-post">POST</span>');
    expect(html).toContain('Request body');
    expect(html).toContain('<span class="req">required</span>');
    expect(html).not.toContain('<th>Description</th>');
  });
});
