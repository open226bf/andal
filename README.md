# Andal

Outil de documentation open source pour équipes tech : volumes par projet, pages numérotées, édition collaborative, blocs Mermaid, OpenAPI et draw.io, droits lecture / commentaire / écriture par projet et par page.

Ce dépôt est le **squelette** : la page de doc fonctionne de bout en bout (lecture, édition temps réel, commentaires et citations, droits, recherche), comme la bibliothèque des volumes (rayons, étagère personnelle, créer, régler, archiver, supprimer), les pages du sommaire (créer, glisser-déposer, corbeille, historique), la gestion des comptes, des groupes et des accès, et les notifications ; le reste est listé plus bas. La direction visuelle est décrite dans [DESIGN.md](DESIGN.md), le produit dans [PRODUCT.md](PRODUCT.md), et la maquette de référence est dans [maquette/index.html](maquette/index.html).

**Le nom.** *Andal* vient du fulfulde *anndal* : le savoir, la science. Le prototype s'appelait Calepin ; les identifiants de l'infra de développement (base et utilisateur Postgres, realm et client Keycloak, clés RustFS, mot de passe de démo) gardent ce nom pour ne pas casser les volumes Docker déjà créés.

## Démarrer

Prérequis : Node 22.12 ou plus, pnpm 11 (`corepack enable`), Docker.

```bash
cp .env.example .env
```

```bash
pnpm infra:up
```

```bash
pnpm install
```

```bash
pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

Ouvrez ensuite http://localhost:5173 et connectez-vous avec un compte de démo : l'identifiant est dans le tableau plus bas, le mot de passe est `DEMO_PASSWORD` dans `.env`. `pnpm db:seed` remet la base de démo à zéro à tout moment (il refuse de tourner avec `NODE_ENV=production`).

Sur une installation neuve, sans données de démo, créez le premier compte (il devient propriétaire de l'espace) :

```bash
pnpm db:migrate && pnpm user:add
```

## Ports

Tout écoute sur 127.0.0.1 uniquement.

| Service | Port | Rôle |
|---|---|---|
| web (Vite) | 5173 | Interface ; relaie `/api` vers l'API et `/collab` vers le serveur collab |
| api (NestJS) | 3001 | REST, sessions, droits, recherche |
| collab (Hocuspocus) | 3002 | Édition temps réel (Yjs), contrôle des droits à la connexion |
| worker (BullMQ) | – | Indexation plein texte après chaque enregistrement, emails de notification |
| PostgreSQL 18 | 55432 | Données, arbre `ltree`, recherche `tsvector`, journal d'audit |
| Valkey 8 | 56379 | Sessions et file de tâches |
| RustFS | 59000 / 59001 | Stockage S3 des fichiers joints (pas encore branché) |
| draw.io | 58081 | Éditeur de schémas embarqué |
| Mailpit | 51025 / 58025 | Faux serveur SMTP de dev ; les emails envoyés se lisent sur http://localhost:58025 |
| Keycloak | 58080 | SSO OIDC, uniquement avec `docker compose --profile sso up -d` |

## Comptes de démo

| Identifiant | Compte | Ce qu'il montre |
|---|---|---|
| `aminata` | Aminata K. | Écrit sur Paiements ; seulement commentaire sur 3.3 Webhooks (restreinte en écriture à Thomas). Une citation de Thomas l'attend dans ses notifications |
| `thomas` | Thomas R. | Écrit sur Paiements, y compris 3.3 Webhooks ; écrit sur Identité |
| `lea` | Léa M. | Commente sur Paiements ; ne voit pas 4.1 Runbook incident (restreinte au groupe Équipe Paiements) |
| `nora` | Nora B. (prestataire) | Invitée, lecture seule sur Paiements, aucun autre volume |
| `camille` | Camille D. | Propriétaire de l'espace : gère les comptes (menu du compte → Gérer les comptes), admin de tous les volumes |

L'email (`aminata@andal.test`…) marche aussi comme identifiant.

La démo compte 12 volumes rangés en 4 rayons (Données et analytics reste hors rayon). Chacun a épinglé les cinq premiers sur son étagère ; les autres attendent dans la bibliothèque.

## Connexion

**Par mot de passe, par défaut.** Comptes locaux, identifiant ou email au choix, sans tenir compte de la casse.

- Mots de passe hachés en Argon2id (19 Mio, 2 passes), 12 caractères minimum, sans règle de composition, refusés s'ils contiennent l'email ou l'identifiant.
- Après 8 échecs sur un compte (ou 40 depuis une adresse IP) en 15 minutes, les tentatives sont bloquées jusqu'à la fin de la fenêtre. Même message et même temps de réponse que le compte existe ou non.
- Sessions côté serveur : cookie `HttpOnly`, `SameSite=Lax` (et `Secure` en production) portant un identifiant aléatoire ; Valkey n'en garde que l'empreinte. Une nouvelle session est créée à chaque connexion.
- Changer son mot de passe (menu du compte) ferme toutes ses autres sessions, dans l'API comme dans le serveur collab.
- Les requêtes qui modifient l'état et viennent d'une autre origine que `WEB_ORIGIN` sont refusées.
- Un compte désactivé ne peut plus se connecter, et ses sessions ouvertes (API et collab) sont coupées sur-le-champ.
- En ligne de commande, pour amorcer une installation ou dépanner : `pnpm user:add` crée un compte, `pnpm user:password <identifiant>` en change le mot de passe.

**Par SSO OpenID Connect, en option.** Désactivé tant que `OIDC_ISSUER` est vide. Pour l'essayer avec le Keycloak local :

```bash
docker compose --profile sso up -d keycloak
```

Décommentez ensuite le bloc `OIDC_*` de `.env` et relancez `pnpm dev`. Un bouton « Se connecter avec Keycloak » apparaît sous le formulaire. Le realm de dev contient `thomas` (lié au compte Andal de Thomas par son email vérifié) et `inconnu` (sans compte Andal, donc refusé), avec le même mot de passe que la démo.

Avec un autre fournisseur (Authentik, Entra ID, Google…), renseignez son émetteur, l'identifiant et le secret du client, et déclarez chez lui l'adresse de retour `WEB_ORIGIN/api/auth/callback`.

- Code d'autorisation avec PKCE (S256), `state` et `nonce` ; l'état du parcours vit dans Valkey. HTTP n'est accepté qu'hors production.
- Une identité se rattache à un compte par son couple émetteur + sujet. À la première connexion, elle est liée au compte qui a le même email, si le fournisseur l'a vérifié. Sinon elle est refusée, sauf si `OIDC_AUTO_CREATE=true` : un compte membre est alors créé, sans aucun volume tant qu'un admin ne lui en ouvre pas.
- Se déconnecter ferme aussi la session chez le fournisseur.
- `AUTH_PASSWORD=false` ne laisse que le SSO. L'API refuse de démarrer si aucun mode n'est actif.

## Gestion des comptes

L'administration (`/admin`, depuis le menu du compte, onglets **Comptes** et **Groupes**) est réservée au propriétaire et aux admins de l'espace.

- **Inviter** : email, nom facultatif, rôle dans l'espace et, au choix, des groupes. La personne reçoit un lien (valable 7 jours) où elle choisit son nom, son identifiant et son mot de passe, puis arrive connectée, avec les volumes de ses groupes déjà ouverts. Sans groupe, elle n'a aucun volume tant qu'on ne lui en ouvre pas. Les invitations en attente se renvoient (nouveau lien, l'ancien ne marche plus) ou se révoquent.
- **Changer le rôle**, **désactiver** ou **réactiver** un compte.
- **Réinitialiser le mot de passe** : un lien valable 24 heures part par email. Le mot de passe ne change qu'au moment où la personne en choisit un nouveau ; toutes ses sessions sont alors fermées.
- **Mot de passe oublié**, depuis l'écran de connexion : lien valable 1 heure, envoyé seulement si le compte existe, avec la même réponse dans tous les cas.

Règles, vérifiées dans l'API et pas seulement dans l'interface :

- Personne ne se gère soi-même depuis cet écran (pas d'auto-désactivation ni d'auto-promotion).
- Un admin ne touche pas aux comptes propriétaires et ne peut pas nommer de propriétaire.
- L'espace garde toujours au moins un propriétaire actif.
- Les liens d'invitation et de réinitialisation sont aléatoires (256 bits), à usage unique ; seule leur empreinte est en base. Un lien expiré, déjà utilisé ou remplacé affiche « Ce lien n'est plus valable ».

**Envoi des emails.** Avec `SMTP_URL` (Mailpit en dev, voir les ports), Andal envoie les invitations et les liens de réinitialisation. Sans SMTP, l'écran affiche le lien d'invitation ou de réinitialisation à copier et transmettre soi-même, et « Mot de passe oublié » disparaît de l'écran de connexion. Quand un email de réinitialisation est parti, l'admin ne voit jamais le lien.

## Commentaires

- Un commentateur (ou plus) sélectionne un passage dans le texte : un bouton **Commenter** apparaît dans la marge, et le fil s'écrit à hauteur du passage. ⌘ Entrée envoie, Échap annule.
- Le passage est marqué par le **serveur collab**, pas par le navigateur : un commentateur n'a pas le droit d'écrire dans le document, et cette marque ne compte pas comme une modification (ni version, ni auteur de la page ne changent).
- Répondre, résoudre (le fil quitte la marge et rejoint « Fils résolus »), rouvrir. Les fils dont le passage a été supprimé du texte restent consultables sous « Sans passage ».
- Supprimer : chacun ses propres messages ; supprimer le premier message supprime le fil et retire la marque du texte. Une fois que d'autres ont répondu, seul un admin du volume peut supprimer le fil.
- Les autres lecteurs de la page voient les nouveaux fils et réponses arriver sans recharger.
- Un lecteur voit les fils mais ne peut ni en créer ni répondre.

- **Citer quelqu'un** : `@` puis quelques lettres propose les personnes qui peuvent lire la page. La personne citée est prévenue. Citer quelqu'un qui ne lit pas la page ne lui envoie rien, et l'auteur en est averti.

## Volumes

### La bibliothèque et l'étagère

L'accueil (`/`) est la **bibliothèque** : tous les volumes qui vous sont ouverts, rangés par **rayon**, avec leur description, votre droit, leur nombre de pages et leur dernière activité. On les filtre en tapant (`/` place le curseur, Entrée ouvre le premier), on les trie par numéro, nom ou activité récente, on replie un rayon. Sur grand écran, l'index des rayons reste à côté de la liste.

- **L'étagère**, à gauche, ne porte que les volumes que **vous** épinglez (la punaise d'une fiche, ou celle de l'en-tête du sommaire). Un volume ouvert sans être épinglé s'y ajoute le temps de la visite, après un trait pointillé. L'icône des livres, en tête, ramène à la bibliothèque ; l'étagère défile quand elle est pleine.
- **Changer de volume** sans repasser par la bibliothèque : le nom du volume, en tête du sommaire, ouvre un sélecteur à filtrer au clavier (étagère d'abord, puis rayon par rayon). La recherche (⌘K) trouve aussi les volumes par leur nom.
- **Les rayons** n'ont qu'un niveau : ils se parcourent d'un coup d'œil même avec beaucoup de volumes. Les admins de l'espace les créent, les renomment, les ordonnent et les suppriment (« Ranger les rayons ») ; supprimer un rayon laisse ses volumes hors rayon, sans rien perdre. L'admin d'un volume choisit son rayon à la création ou dans ses réglages.

### Créer, régler, archiver

Le « + » sous les dos de l'étagère, ou « Nouveau volume » dans la bibliothèque, crée un volume (membres et admins de l'espace, pas les invités) : nom, nom court écrit sur le dos, description, et une des six toiles, avec l'aperçu du dos tel qu'il sera rangé. Qui le crée en devient admin et le trouve épinglé sur son étagère ; il s'ouvre sur une première page, « Présentation », en mode Modifier. Par défaut il prend la toile la moins portée de l'étagère.

La roue crantée à côté du nom du volume, dans le sommaire, ouvre ses réglages (admins du volume) :

- **Modifier** le nom, le nom court, la description, la toile et le rayon. L'adresse du volume (`/v/…`) ne change pas, pour ne casser aucun lien.
- **Archiver** : le volume quitte l'étagère et la recherche, et passe en lecture seule pour tout le monde, admins compris, pages déjà ouvertes comprises. Ses liens marchent toujours, avec un bandeau « Volume archivé ». Ni page, ni commentaire, ni accès, ni réglage ne bouge tant qu'il n'est pas désarchivé.
- **Désarchiver**, depuis les réglages ou depuis « Volumes archivés » dans le menu du compte, qui liste les volumes archivés que vous administrez.
- **Supprimer** : réservé aux admins de l'espace, seulement pour un volume archivé, en retapant son nom court. Pages, commentaires, historique et droits partent avec lui ; le journal d'audit garde la trace.

## Pages

Qui peut écrire sur une page peut la **tirer** dans le sommaire : vers le haut ou le bas d'une autre page pour la placer avant ou après, au milieu pour la ranger dedans, ou sur « Déposer ici : fin du volume ». Un trait ou un cadre montre où elle atterrira. Le même bouton « ⋯ », au survol, fait tout cela au clavier et sur écran tactile : ajouter une sous-page, renommer, monter, descendre, déplacer sous une autre page, mettre à la corbeille. Le « + » à côté du nom du volume ajoute une page au premier niveau ; la corbeille est en bas du sommaire.

- **Créer** demande le droit d'écriture sur la page parente (sur le volume au premier niveau). La nouvelle page hérite des restrictions de sa parente et s'ouvre en mode Modifier ; son titre se modifie là, directement.
- **Déplacer** emporte les sous-pages, leurs commentaires et leurs restrictions. Un déplacement qui ferait sortir une page d'une restriction héritée est refusé : elle s'ouvrirait à plus de monde sans que personne l'ait décidé. Levez d'abord la restriction, ou restez sous la page qui la porte.
- **La corbeille** reçoit la page et ses sous-pages d'un bloc ; il faut pouvoir modifier chacune. Elles disparaissent du sommaire, de la recherche et des notifications, et les pages ouvertes se ferment. Restaurer les remet à la fin de leur section, avec leurs commentaires ; une page dont la parente est aussi à la corbeille attend sa parente.
- **Suppression définitive** : après `TRASH_RETENTION_DAYS` jours (30 par défaut), le worker vide la corbeille (il passe toutes les 6 heures) ; chaque page indique sa date. Un admin du volume peut aussi supprimer tout de suite, depuis la corbeille. Sous-pages, commentaires et historique partent avec la page.
- Les numéros de section suivent tout de suite, chez tout le monde : le serveur collab prévient les navigateurs ouverts.

### Écrire : fichiers, tableaux, tâches, liens

La barre du mode Modifier insère, en plus du texte et des blocs techniques :

- **Images et fichiers** : bouton Image ou Fichier, ou simplement coller une capture d'écran, ou déposer des fichiers dans la page. Une image devient une figure numérotée, avec légende et texte alternatif ; tout autre fichier devient une fiche à télécharger. Les fichiers vont dans le stockage S3 (RustFS en dev), 25 Mo au plus (`UPLOAD_MAX_MB`). Qui lit la page lit ses fichiers, personne d'autre : l'API vérifie la lecture à chaque téléchargement. Le type d'une image est lu dans le fichier, pas dans ce qu'annonce le navigateur ; tout fichier est servi sous `CSP: sandbox`, et ce qui n'est pas une image se télécharge sans jamais s'afficher. Les fichiers d'une page purgée quittent le stockage dans l'heure.
- **Tableaux** : ligne d'en-tête, colonnes redimensionnables, Tab pour passer d'une cellule à l'autre ; les outils du tableau apparaissent dans la barre quand le curseur y est. Sur mobile, un tableau large défile dans son cadre.
- **Listes de tâches** : des cases à cocher, en lecture seule pour qui ne peut pas modifier la page.
- **Liens** (⌘K ou Ctrl K dans le texte) : chercher une page par son titre ou son numéro, dans tous les volumes que vous lisez, ou coller une adresse web. Un lien vers une page passe par son adresse stable `/p/<id>`, qui la retrouve même déplacée. Au survol, un aperçu montre le volume, le numéro, le titre et le début de la page ; une page que vous ne lisez pas reste « introuvable ». En mode Modifier, ⌘ ou Ctrl + clic suit le lien.
- **Rétroliens** : en bas de chaque page, « Citée dans » liste les pages qui y renvoient, seulement celles que vous pouvez lire.

### Historique

Le lien **Historique** du colophon liste les versions de la page, avec leurs auteurs, et montre chacune telle qu'elle était, schémas compris.

- Une version regroupe une séance de travail : tant que la page change sans 10 minutes de silence, la même version s'allonge et ajoute ses auteurs. Écrire à plusieurs donne une version à plusieurs noms, pas une par enregistrement.
- Une version n'est enregistrée que si le contenu change vraiment : ouvrir une page avec le droit d'écriture, ou s'y reconnecter, ne crée ni version ni « modifiée par ».
- **Restaurer** une version (droit d'écriture) remplace le contenu pour tout le monde, pages ouvertes comprises, et crée une nouvelle version : rien n'est perdu, la version remplacée reste dans l'historique. Le titre revient aussi s'il avait changé.

## Gestion des accès

Le bouton **Partager** du bandeau montre et, selon vos droits, modifie deux choses.

- **L'accès au volume** (admins du volume) : ajouter une personne ou un groupe, changer son rôle (lecture, commentaire, écriture, admin du volume), le retirer.
- **Les restrictions de la page** (droit d'écriture sur la page) : réserver la lecture ou l'écriture à une liste de personnes et de groupes, la modifier, la lever. Une restriction s'applique aux sous-pages ; celles héritées d'une page parente sont rappelées avec un lien vers elle.

Règles, vérifiées dans l'API :

- Personne ne se retire par mégarde son propre accès : on ne quitte pas l'administration d'un volume, et on ne restreint pas une page sans y figurer (soi-même ou par un groupe).
- Un invité de l'espace ne dépasse jamais l'écriture sur un volume, même par un groupe : administrer un volume, c'est pouvoir l'ouvrir à d'autres.
- Un groupe qui sert à restreindre une page ne peut pas être supprimé : la liste pourrait se vider et ouvrir la page à tout le volume.
- Chaque changement est audité, et s'applique tout de suite, y compris aux pages déjà ouvertes : le serveur collab revérifie chaque connexion (passage en lecture seule, ou fermeture), et les navigateurs relisent la page, le sommaire et le partage.

L'onglet **Groupes** de l'administration crée, renomme et supprime les groupes, ajoute et retire leurs membres, et montre les volumes que chacun ouvre.

## Notifications

La cloche de l'étagère prévient quand quelqu'un vous cite, répond dans un fil où vous avez écrit, ou résout un fil que vous avez ouvert. Une notification mène au fil, sur sa page, et se marque comme lue.

- En direct sur les pages ouvertes (par le serveur collab), sinon à la minute.
- Une notification montre un extrait du commentaire : elle disparaît pour qui perd l'accès à la page, et revient avec l'accès.
- **Par email**, seulement ce qui est resté non lu : après `NOTIFY_EMAIL_DELAY` secondes (300 par défaut, 30 dans `.env.example`), le worker envoie un seul message qui regroupe tout ce qui attend. Chacun peut le désactiver depuis la cloche (« Aussi par email »).

La page la plus complète est **Paiements → 3.2 Authentification** : notes en marge, diagramme de séquence Mermaid, listing de code, encadré, endpoint OpenAPI et schéma draw.io.

## Organisation

```
apps/
  web/      React 19, Vite, Tailwind 4, TanStack Router et Query, TipTap 3
  api/      NestJS 11 sur Fastify; fichiers vers le stockage S3
  collab/   Hocuspocus 3 (Yjs), validation du schéma avant écriture
  worker/   BullMQ: texte et liens pour la recherche et les rétroliens, emails, purges (corbeille, fichiers)
packages/
  authz/    Modèle de droits, pur et testé
  db/       Kysely, migrations, seed, requêtes d'accès, stockage S3
  editor/   Schéma TipTap partagé client / serveur (Mermaid, OpenAPI, draw.io, image, pièce jointe, tableau, tâches, encadré, commentaire)
  ui/       Jetons de design (CSS) et composants de base
deploy/     Images, compose de production, Caddy (voir deploy/README.md)
tests/e2e/  Suites de bout en bout (Python, sans dépendance)
infra/      Realm Keycloak de dev
```

## Modèle de droits

- Rôles par volume : lecteur, commentateur, éditeur, admin. Ils s'accordent à une personne ou à un groupe ; le plus fort l'emporte.
- Le propriétaire et les admins de l'espace sont admins de tous les volumes.
- Une page peut être restreinte en **lecture** (hors de la liste, la page n'existe pas : 404, absente du sommaire et de la recherche) ou en **écriture** (hors de la liste, le rôle plafonne à commentateur).
- Les restrictions s'héritent des pages parentes et ne font que réduire les droits, jamais les élargir.
- Un volume archivé plafonne tout le monde à la lecture ; seul le rôle d'origine décide de qui peut le désarchiver.
- Refus par défaut. Le contrôle se fait dans l'API **et** dans le serveur collab : une connexion sans droit d'édition y est ouverte en lecture seule, quel que soit le client.

## Vérifier

```bash
pnpm test
```

Lance les tests du modèle de droits et du schéma de l'éditeur.

```bash
tests/e2e/run.sh
```

Avec la stack lancée : les suites de bout en bout (comptes, accès et notifications, pages, versions, volumes, fichiers et liens), puis les deux vérifications du serveur collab ci-dessous. Chaque suite repart des données de démo ; `tests/e2e/run.sh files_links_test` n'en lance qu'une. La CI GitHub les fait tourner à chaque commit, sur une stack complète.

```bash
pnpm --filter @andal/collab check:readonly
```

Avec la stack lancée : se connecte au serveur collab en tant que Léa, tente une écriture brute dans le document Yjs, et vérifie que la base n'a pas bougé. `check:readonly aminata` fait la contre-épreuve : l'écriture passe. Relancez `pnpm db:seed` ensuite pour nettoyer.

```bash
pnpm --filter @andal/collab check:live-access
```

Avec la stack lancée : Aminata écrit sur « Glossaire » par une connexion ouverte, puis Camille lui retire l'écriture, puis la lecture. Vérifie que la même connexion passe en lecture seule, puis qu'elle est fermée. Ensuite Camille archive le volume Paiements pendant qu'Aminata a « Conventions » ouverte : la page passe en lecture seule, puis redevient modifiable au désarchivage. Relancez `pnpm db:seed` ensuite.

## Déployer

Images Docker, compose de production derrière Caddy (TLS automatique, CSP stricte), premier compte, sauvegardes et mises à jour : voir [deploy/README.md](deploy/README.md). La CI publie `ghcr.io/open226bf/andal-server` et `andal-web` à chaque commit sur `main` (étiquette `edge`) et à chaque version `v*`.

```bash
pnpm --filter @andal/collab check:deploy
```

Avec `ANDAL_URL`, `ANDAL_USER` et `ANDAL_PASSWORD` : vérifie une installation déployée, de HTTPS à la collaboration temps réel.

## Ce qui reste à faire

- **Comptes** : double authentification pour les comptes locaux, liste des sessions ouvertes.
- **SSO** : reprendre les groupes du fournisseur (le realm envoie déjà le claim `groups`) pour alimenter les groupes Andal.
- **Gestion des accès** : un journal d'audit consultable par les admins ; un réglage d'espace pour réserver la création de volumes aux admins (`canCreateProject` le prévoit déjà).
- **Commentaires** : modification d'un message déjà envoyé, création de fil sur mobile à éprouver sur un vrai téléphone.
- **Notifications** : une notification qui arrive pendant l'envoi de l'email groupé attend l'email suivant ; pas encore de notification pour les modifications de pages suivies.
- **Bibliothèque** : ordonner son étagère à la main (aujourd'hui par numéro de volume) ; glisser un volume d'un rayon à l'autre depuis la bibliothèque.
- **Pages** : comparer deux versions (aujourd'hui on les regarde l'une après l'autre) ; replier les sections du sommaire.
- **Fichiers** : les schémas draw.io sont encore stockés en data URI dans le document, pas dans le stockage.
- **Redoc** : le bouton « Ouvrir dans Redoc » est désactivé, faute de spec stockée.
- **Export PDF** (Gotenberg), extension Redis de Hocuspocus pour lancer plusieurs instances collab.
- **Durcissement** : RLS PostgreSQL en seconde barrière, limitation de débit au-delà de la connexion, `trustProxy` à régler selon le proxy de production (aujourd'hui l'API fait confiance à `X-Forwarded-For`).
- **Enregistrement refusé** : quand le serveur collab rejette un contenu invalide, l'éditeur n'en est pas averti ; il faudrait le signaler à l'écran.
- **Performance** : le bundle principal fait environ 1,1 Mo minifié ; charger l'éditeur à la demande en mode lecture.
- **Choix à trancher** : la numérotation est calculée sur toutes les pages pour rester stable entre lecteurs. Une personne qui ne voit pas 4.1 voit donc « 4.2 Astreinte » et peut en déduire qu'une page 4.1 existe.

## Licence

Apache-2.0, voir [LICENSE](LICENSE).
