import { describe, expect, it } from 'vitest';
import { countNumbered, extractPageLinks, extractText, fileUrl, pageIdFromHref, sameDoc, validateDoc } from './index.js';

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

describe('fichiers, tableaux, tâches', () => {
  const id = '0b5e8a52-3f0c-4a51-9d2e-8f6b1c2d3e4f';
  const cell = (type: string, text: string) => ({ type, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const rich = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { fileId: id, alt: 'Schéma réseau', caption: 'Réseau' } },
      { type: 'attachment', attrs: { fileId: id, name: 'contrat.pdf', size: 1200, contentType: 'application/pdf' } },
      { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'Code'), cell('tableHeader', 'Sens')] }, { type: 'tableRow', content: [cell('tableCell', '429'), cell('tableCell', 'Trop de requêtes')] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tourner la clé' }] }] }] },
    ],
  };

  it('accepte image, pièce jointe, tableau et liste de tâches', () => {
    expect(validateDoc(rich)).toBeNull();
  });

  it("compte l'image comme une figure et indexe son texte", () => {
    expect(countNumbered(rich).figures).toBe(1);
    expect(extractText(rich)).toBe('Réseau Schéma réseau contrat.pdf Code Sens 429 Trop de requêtes Tourner la clé');
  });

  it("n'accepte qu'un identifiant de fichier", () => {
    expect(fileUrl(id)).toBe(`/api/files/${id}`);
    expect(fileUrl('../auth/logout')).toBe('');
  });
});

describe('liens entre pages', () => {
  const a = '0b5e8a52-3f0c-4a51-9d2e-8f6b1c2d3e4f';
  const b = '6d1f0c3e-2a4b-4c5d-8e9f-a0b1c2d3e4f5';
  const link = (href: string, text = 'voir') => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });

  it('reconnaît /p/<id>, une adresse de page collée, et ignore le reste', () => {
    expect(pageIdFromHref(`/p/${a}`)).toBe(a);
    expect(pageIdFromHref(`https://docs.example.com/v/paiements/${b.toUpperCase()}?thread=x`)).toBe(b);
    expect(pageIdFromHref('https://example.com/p/pas-un-id')).toBeNull();
    expect(pageIdFromHref('javascript:alert(1)')).toBeNull();
  });

  it('liste les pages citées sans doublon', () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [link(`/p/${a}`), link(`/p/${a}`, 'encore'), link('https://example.com'), link(`/v/x/${b}`)] }] };
    expect(extractPageLinks(json)).toEqual([a, b]);
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
