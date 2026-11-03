import { describe, expect, it } from 'vitest';
import { countNumbered, extractText, sameDoc, validateDoc } from './index.js';

const doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Bonjour ' }, { type: 'text', text: 'jeton', marks: [{ type: 'comment', attrs: { threadId: 't1' } }] }] },
    { type: 'mermaid', attrs: { source: 'graph TD; A-->B', caption: 'Flux' } },
    { type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'curl x' }] },
    { type: 'callout', attrs: { tone: 'note', title: 'À retenir' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Expire vite' }] }] },
  ],
};

describe('schéma partagé', () => {
  it('accepte un document conforme', () => {
    expect(validateDoc(doc)).toBeNull();
  });

  it('accepte un commentaire posé sur du code en ligne', () => {
    const text = { type: 'text', text: 'Authorization', marks: [{ type: 'code' }, { type: 'comment', attrs: { threadId: 't1' } }] };
    expect(validateDoc({ type: 'doc', content: [{ type: 'paragraph', content: [text] }] })).toBeNull();
  });

  it('refuse le gras dans du code en ligne', () => {
    const text = { type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'code' }] };
    expect(validateDoc({ type: 'doc', content: [{ type: 'paragraph', content: [text] }] })).not.toBeNull();
  });

  it('refuse un nœud inconnu', () => {
    expect(validateDoc({ type: 'doc', content: [{ type: 'script', content: [] }] })).not.toBeNull();
  });

  it('compte figures et listings', () => {
    expect(countNumbered(doc)).toEqual({ figures: 1, listings: 1 });
  });

  it('extrait le texte, légendes comprises', () => {
    expect(extractText(doc)).toBe('Bonjour jeton Flux curl x À retenir Expire vite');
  });
});

describe('sameDoc', () => {
  const drawio = (attrs: Record<string, unknown>) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Avant' }] }, { type: 'drawio', attrs }] });

  it('ignore un attribut nul absent du JSON', () => {
    expect(sameDoc(drawio({ src: 'data:x', xml: null, caption: null }), drawio({ src: 'data:x' }))).toBe(true);
  });

  it('voit un paragraphe ajouté, même vide', () => {
    const before = drawio({ src: 'data:x' });
    expect(sameDoc(before, { ...before, content: [...before.content, { type: 'paragraph' }] })).toBe(false);
  });
});
