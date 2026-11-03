import { describe, expect, it } from 'vitest';
import { localeFromHeader, tr, translateMessage, trn } from './i18n.js';
import { en } from './i18n-en.js';

describe('translateMessage', () => {
  it('traduit un message exact', () => {
    expect(translateMessage('Compte introuvable.', 'en')).toBe('Account not found.');
    expect(translateMessage("Réservé aux admins de l'espace.", 'en')).toBe('Restricted to workspace admins.');
  });

  it('retrouve la valeur d’un message à une variable', () => {
    expect(translateMessage('Le compte de Léa Martin est désactivé.', 'en')).toBe('Léa Martin’s account is disabled.');
    expect(translateMessage('Trop de tentatives. Réessayez dans 15 min.', 'en')).toBe('Too many attempts. Try again in 15 min.');
  });

  it('retrouve les valeurs d’un message à deux variables', () => {
    expect(translateMessage('Trop de requêtes: au plus 120 écritures par minute. Réessayez dans 42 s.', 'en')).toBe('Too many requests: at most 120 writes per minute. Try again in 42 s.');
    expect(translateMessage('Le modèle a répondu 401: {"error":"invalid key"}', 'en')).toBe('The model responded 401: {"error":"invalid key"}');
    // Le motif sans détail ne prend pas le pas sur celui avec.
    expect(translateMessage('Le modèle a répondu 503', 'en')).toBe('The model responded 503');
  });

  it('distingue singulier et pluriel', () => {
    const one = 'Ce groupe restreint l’accès à 1 page. Retirez-le d’abord de ces restrictions: le supprimer pourrait les ouvrir à tout le volume.';
    const many = 'Ce groupe restreint l’accès à 3 pages. Retirez-le d’abord de ces restrictions: le supprimer pourrait les ouvrir à tout le volume.';
    expect(translateMessage(one, 'en')).toMatch(/^This group restricts access to 1 page\. /);
    expect(translateMessage(many, 'en')).toMatch(/^This group restricts access to 3 pages\. /);
  });

  it('laisse tel quel un message inconnu', () => {
    expect(translateMessage('Un message qui n’est pas au catalogue.', 'en')).toBe('Un message qui n’est pas au catalogue.');
    expect(translateMessage('Not Found', 'en')).toBe('Not Found');
  });

  it('ne touche à rien en français', () => {
    expect(translateMessage('Compte introuvable.', 'fr')).toBe('Compte introuvable.');
    expect(translateMessage('Le compte de Léa est désactivé.', 'fr')).toBe('Le compte de Léa est désactivé.');
  });
});

describe('tr et trn', () => {
  it('remplit les variables dans les deux langues', () => {
    expect(tr('fr', 'Bonjour {name},', { name: 'Léa' })).toBe('Bonjour Léa,');
    expect(tr('en', 'Bonjour {name},', { name: 'Léa' })).toBe('Hello Léa,');
    // Inconnu du catalogue: la phrase française.
    expect(tr('en', 'Phrase absente {x}', { x: 1 })).toBe('Phrase absente 1');
  });

  it('suit les règles du pluriel de chaque langue', () => {
    const one = '{n} nouveauté vous attend sur Andal';
    const other = '{n} nouveautés vous attendent sur Andal';
    expect(trn('fr', 0, one, other)).toBe('0 nouveauté vous attend sur Andal');
    expect(trn('fr', 1, one, other)).toBe('1 nouveauté vous attend sur Andal');
    expect(trn('fr', 2, one, other)).toBe('2 nouveautés vous attendent sur Andal');
    expect(trn('en', 0, one, other)).toBe('0 updates are waiting for you on Andal');
    expect(trn('en', 1, one, other)).toBe('1 update is waiting for you on Andal');
    expect(trn('en', 5, one, other)).toBe('5 updates are waiting for you on Andal');
  });
});

describe('localeFromHeader', () => {
  it('suit les préférences pondérées (q)', () => {
    expect(localeFromHeader('fr;q=0.5, en;q=0.9')).toBe('en');
    expect(localeFromHeader('en;q=0.2, fr')).toBe('fr');
    expect(localeFromHeader('de, en;q=0.8, fr;q=0.7')).toBe('en');
  });

  it('ramène une région à sa langue', () => {
    expect(localeFromHeader('en-GB,en;q=0.9,fr;q=0.8')).toBe('en');
    expect(localeFromHeader('fr-CA')).toBe('fr');
    expect(localeFromHeader('EN-us')).toBe('en');
  });

  it('retombe sur le français sans langue reconnue', () => {
    expect(localeFromHeader(undefined)).toBe('fr');
    expect(localeFromHeader('')).toBe('fr');
    expect(localeFromHeader('de-DE, es;q=0.9')).toBe('fr');
    expect(localeFromHeader('*')).toBe('fr');
  });
});

describe('catalogue', () => {
  it('garde les mêmes variables des deux côtés', () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [source, target] of Object.entries(en)) expect(names(target), source).toEqual(names(source));
  });

  it('écrit l’anglais avec l’apostrophe typographique', () => {
    for (const [source, target] of Object.entries(en)) expect(target.includes("'"), source).toBe(false);
  });
});
