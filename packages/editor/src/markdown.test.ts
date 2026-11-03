import { describe, expect, it } from 'vitest';
import { validateDoc, type JSONContent } from './index.js';
import { fromMarkdown, toMarkdown } from './markdown.js';

const FILE = '3f1c9a4e-5b8d-4c2a-9e71-0d6b2f8a1c35';

const source = `## Obtenir un jeton

Le service **client** envoie _ses_ identifiants à \`/oauth/token\`, voir [le runbook](/p/${FILE}).

- [x] Créer le client
- [ ] Faire tourner le secret

1. Un
2. Deux

> [!WARNING] Secret
> Ne le stockez **jamais** côté navigateur.

\`\`\`mermaid title="Échange des identifiants"
sequenceDiagram
  C->>A: POST /oauth/token
\`\`\`

\`\`\`openapi
spec: paiements
operation: post /oauth/token
\`\`\`

| Code | Cause |
| --- | --- |
| \`401\` | Secret faux |

![Topologie](/api/files/${FILE} "Le réseau")

[contrat.pdf](/api/files/${FILE})
`;

describe('Markdown', () => {
  const doc = fromMarkdown(source);
  const types = (doc.content ?? []).map((n) => n.type);

  it('lit le Markdown de GitHub et les blocs d’Andal', () => {
    expect(types).toEqual(['heading', 'paragraph', 'taskList', 'orderedList', 'callout', 'mermaid', 'openapi', 'table', 'image', 'attachment']);
    expect(validateDoc(doc)).toBeNull();
  });

  it('garde marques, liens, tâches, encadré et attributs', () => {
    const para = doc.content![1]!;
    expect(para.content?.find((n) => n.text === 'client')?.marks).toEqual([{ type: 'bold' }]);
    expect(para.content?.find((n) => n.text === '/oauth/token')?.marks).toEqual([{ type: 'code' }]);
    expect(para.content?.find((n) => n.text === 'le runbook')?.marks).toEqual([{ type: 'link', attrs: { href: `/p/${FILE}` } }]);
    expect(doc.content![2]!.content?.map((i) => i.attrs?.checked)).toEqual([true, false]);
    expect(doc.content![2]!.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('Créer le client');
    expect(doc.content![4]!.attrs).toEqual({ tone: 'warning', title: 'Secret' });
    expect(doc.content![5]!.attrs).toEqual({ source: 'sequenceDiagram\n  C->>A: POST /oauth/token', caption: 'Échange des identifiants' });
    expect(doc.content![6]!.attrs).toMatchObject({ specFile: 'paiements', operationKey: 'POST /oauth/token' });
    expect(doc.content![8]!.attrs).toEqual({ fileId: FILE, alt: 'Topologie', caption: 'Le réseau' });
  });

  it('refuse les liens javascript:', () => {
    const evil = fromMarkdown('[clic](javascript:alert(1)) et [ok](https://exemple.org)');
    const marks = evil.content![0]!.content!.flatMap((n) => n.marks ?? []);
    expect(marks).toEqual([{ type: 'link', attrs: { href: 'https://exemple.org' } }]);
  });

  it('fait l’aller-retour sans perte', () => {
    const again = fromMarkdown(toMarkdown(doc));
    const strip = (n: JSONContent): JSONContent => JSON.parse(JSON.stringify(n)) as JSONContent;
    expect(strip(again)).toEqual(strip(doc));
  });

  it('écrit un Markdown lisible', () => {
    const out = toMarkdown(doc);
    expect(out).toContain('Le service **client** envoie _ses_ identifiants à `/oauth/token`');
    expect(out).toContain('- [x] Créer le client');
    expect(out).toContain('> [!WARNING] Secret');
    expect(out).toContain('| `401` | Secret faux |');
  });

  it('ne colle pas deux marques identiques consécutives', () => {
    const out = toMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'bold' }] }, { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] }] }] });
    expect(out).toBe('**a_b_**\n');
  });

  it('un document vide reste valide', () => {
    expect(validateDoc(fromMarkdown(''))).toBeNull();
  });
});
