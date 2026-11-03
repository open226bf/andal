# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, Vite, TanStack Router et Query, Tailwind, Radix. Éditeur TipTap (ProseMirror) avec Yjs pour l'édition collaborative. Confirmé par l'utilisateur, d'après l'architecture proposée (monorepo TypeScript: `apps/web`, `apps/api` NestJS, `apps/collab` Hocuspocus, `apps/worker`).

## Users

Équipes tech en priorité: développeurs, architectes, ops. Ils écrivent et maintiennent la documentation technique de leurs projets: specs OpenAPI, diagrammes d'architecture, runbooks, décisions d'architecture. Les profils métiers lisent parfois, sans en être la cible principale.

## Product Purpose

Un wiki de documentation open source et auto-hébergé, organisé comme Confluence (espaces de projet, arbre de pages), pour les équipes tech. Le succès: une équipe y range toute sa doc technique, la retrouve vite, et sait toujours qui peut la lire ou la modifier.

## Positioning

Tout ce que Docmost et Confluence réservent aux offres payantes est dans le cœur gratuit: SSO, MFA, permissions par page, journal d'audit, historique des versions, diagrammes. Les contenus techniques (Mermaid, OpenAPI rendu par Redoc, draw.io) sont des blocs natifs de l'éditeur, pas des pièces jointes ni des plugins.

## Operating Context

- Auto-hébergé, lancé avec docker compose.
- Utilisé au bureau, à côté de l'IDE et du terminal, souvent sur de longues sessions de lecture.
- Édition à plusieurs en temps réel.
- Une CI peut publier une spec OpenAPI dans une page via un jeton d'API limité au projet.

## Capabilities and Constraints

- Hiérarchie: workspace, projets, arbre de pages, pièces jointes et commentaires.
- Rôles workspace: propriétaire, admin, membre, invité.
- Rôles projet: Lecteur, Commentateur, Éditeur, Admin projet.
- Restrictions de page en lecture ou en écriture, héritées par les sous-pages, qui ne font que réduire les droits.
- Liens publics en lecture seule, révocables, avec expiration.
- Comptes locaux, SSO OIDC, MFA (TOTP et passkeys), journal d'audit.
- Blocs Mermaid, OpenAPI/Redoc et draw.io dans l'éditeur, insérés par le menu `/`.
- Licence: Apache-2.0, choisie par l'utilisateur.
- Hypothèse non confirmée: interface en français, avec i18n prévue.

## Brand Commitments

- Mise en page inspirée de Confluence et d'Atlassian, mais plus ludique et plus agréable (demande de l'utilisateur).
- Polices très lisibles (demande de l'utilisateur).
- Ne reprendre ni le logo, ni les icônes, ni le nom d'Atlassian.
- Nom: « Andal », du fulfulde *anndal*, le savoir, la science. Choisi par l'utilisateur; « Calepin » était le nom de travail du prototype.

## Evidence on Hand

Aucune. Pas d'utilisateurs, de témoignages, de chiffres ni de captures réelles. Toute donnée de démonstration doit rester fictive et ne jamais se présenter comme réelle.

## Product Principles

1. La sécurité et le contrôle d'accès font partie du cœur gratuit, jamais d'une offre payante.
2. Le contenu technique est natif: un diagramme ou une spec d'API est un bloc de page, pas un fichier joint.
3. La lecture passe d'abord: une doc est lue bien plus souvent qu'écrite.
4. Les droits se voient: on sait toujours qui peut lire ou modifier une page.
5. S'installe en une commande.

## Accessibility & Inclusion

Lisibilité exigée par l'utilisateur. Cible WCAG 2.2 AA (hypothèse, à confirmer).
