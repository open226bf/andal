# Journal des versions

**Français** · [English](CHANGELOG.md)

Images Docker : `ghcr.io/open226bf/andal-server` et `ghcr.io/open226bf/andal-web`, étiquetées avec la version (`0.1.0`), sa branche mineure (`0.1`) et `latest`. Pour mettre à jour, voir [deploy/README.fr.md](deploy/README.fr.md#mettre-à-jour).

## À venir

Arriver d'un autre outil, et pouvoir en repartir.

### Modèles et export

- **Modèles de page** : décision d'architecture, RFC, runbook et post-mortem, rédigés dans la langue de qui crée la page ; aussi par l'API (`template`).
- **Export d'une page** en Markdown, ou en PDF mis en page pour l'impression (figures numérotées, schémas rendus, numéros de page), par Gotenberg.
- **Export d'un volume** : une archive zip de fichiers Markdown avec en-tête, liens relatifs et fichiers joints, limitée aux pages que vous lisez.

### Partage public

- **Liens publics** vers une page, une page et ses sous-pages, ou tout un volume : lecture sans compte, sans commentaires ni historique, marquée `noindex`. Une page restreinte en lecture n'est jamais publique. Réservés aux admins du volume ; `PUBLIC_LINKS=false` coupe la fonction.

### Import

- **Import** depuis Markdown (un fichier, ou une arborescence zippée, exports de volume compris), Notion (export « Markdown & CSV ») et Confluence (export HTML d'un espace) : arborescence, encadrés, code, tableaux, images, pièces jointes et liens entre pages. Il tourne en tâche de fond, se termine par un bilan et des remarques, et passe aussi par l'API.

### Déploiement

- Nouveau service `gotenberg` dans le compose de production, et nouveaux réglages `GOTENBERG_URL`, `IMPORT_MAX_MB` et `PUBLIC_LINKS` (voir [deploy/README.fr.md](deploy/README.fr.md#variantes)).
- La migration `0017` ajoute les tables des liens publics et des imports ; elle passe toute seule au démarrage.

## 0.1.0 (2026-11-03)

Première version. Elle couvre l'écriture, les droits, la sécurité et l'auto-hébergement ; la migration depuis un autre outil (import, export, modèles, partage public) vient ensuite.

### Écrire et lire

- **Volumes** dans une bibliothèque rangée par rayons, avec une étagère personnelle ; créer, régler, archiver, supprimer.
- **Pages numérotées** dans un sommaire : glisser-déposer, corbeille vidée automatiquement, historique groupé par séance de travail, restauration d'une version.
- **Édition collaborative en temps réel** (TipTap, Yjs) : blocs Mermaid, OpenAPI et draw.io, code, encadrés, images et fichiers, tableaux, listes de tâches.
- **Liens entre pages** : recherche de page à la frappe, aperçu au survol, rétroliens (« Citée dans »).
- **Commentaires** ancrés dans le texte, citations, notifications dans l'application et par email.
- **Recherche** dans tous les volumes que vous pouvez lire (⌘K).

### Droits

- Rôles par volume (lecture, commentaire, écriture, admin) pour des personnes et des groupes.
- Restrictions de lecture ou d'écriture par page, héritées par les sous-pages.
- Vérifiés dans l'API et dans le serveur collab ; un changement s'applique tout de suite, pages déjà ouvertes comprises.

### Comptes et sécurité

- Mots de passe locaux, et SSO OpenID Connect dans le cœur gratuit.
- Double authentification (codes à usage unique et codes de secours), sessions ouvertes que l'on peut fermer, journal d'audit en ajout seul.
- SCIM pour les comptes et les groupes ; groupes repris du fournisseur SSO à chaque connexion.
- Limite de débit sur toute l'API, CSP stricte, fichiers envoyés servis sous `CSP: sandbox`.

### Pour les équipes tech

- **Specs OpenAPI** stockées et versionnées par volume, ouvertes dans Redoc, publiables depuis la CI.
- **API publique** avec jetons ; contenu des pages en entrée et en sortie, en JSON ou en Markdown.
- **Intégrations** : webhooks (JSON signé, Slack, Mattermost, Teams), aperçus des liens GitHub et Jira.
- **Synchro Git** : un dossier de fichiers Markdown d'un dépôt devient des pages d'un volume, mises à jour à chaque push (ou toutes les 10 minutes).
- **Assistant** : réponses tirées des pages que vous pouvez lire, avec leurs sources ; Claude ou tout modèle compatible OpenAI, local compris.

### Exploitation

- Images `linux/amd64` et `linux/arm64` ; compose de production derrière Caddy avec TLS automatique ; premier compte, sauvegardes et mises à jour documentés.
- Plusieurs instances collab derrière Caddy, synchronisées par Valkey.
- Interface en français et en anglais.

### Pas encore là

L'import (Confluence, Notion, Markdown), l'export PDF, les modèles de page et le partage public forment la prochaine étape. La liste complète est dans [Ce qui reste à faire](README.fr.md#ce-qui-reste-à-faire).
