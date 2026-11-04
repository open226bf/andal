# Andal

**Français** · [English](README.md)

Outil de documentation open source pour équipes tech : volumes par projet, pages numérotées, édition collaborative, blocs Mermaid, OpenAPI et draw.io, droits lecture / commentaire / écriture par projet et par page.

**Version 0.1**, la première : son contenu est dans [CHANGELOG.fr.md](CHANGELOG.fr.md), et ce qu'elle ne fait pas encore sous [Ce qui reste à faire](#ce-qui-reste-à-faire). La direction visuelle est décrite dans [DESIGN.md](DESIGN.md), le produit dans [PRODUCT.md](PRODUCT.md), et la maquette de référence est dans [maquette/index.html](maquette/index.html).

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
| Valkey 8 | 56379 | Sessions, file de tâches, limite de débit, synchro et file d'écritures des instances collab |
| RustFS | 59000 / 59001 | Stockage S3 des fichiers joints |
| draw.io | 58081 | Éditeur de schémas embarqué |
| Mailpit | 51025 / 58025 | Faux serveur SMTP de dev ; les emails envoyés se lisent sur http://localhost:58025 |
| Gotenberg | 53000 | Export PDF (Chromium) |
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
- **Double authentification** au choix de chacun (voir « Sécurité des comptes ») : après le mot de passe, un code de l'application d'authentification.
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

L'administration (`/admin`, depuis le menu du compte : onglets **Comptes**, **Groupes**, **Annuaire**, **Journal**, **Intégrations** et **Assistant**) est réservée au propriétaire et aux admins de l'espace.

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

## Sécurité des comptes

**Mon compte** (menu du compte) rassemble le mot de passe, la double authentification, les sessions ouvertes et les jetons d'API.

**Double authentification (TOTP).** Pour les comptes à mot de passe ; un compte SSO la règle chez son fournisseur.

- **Activer** : scanner le QR code avec une application d'authentification (1Password, Bitwarden, Google Authenticator, Aegis…), ou saisir la clé à la main, puis taper un premier code. Rien ne change tant que ce code n'est pas confirmé.
- **Dix codes de secours** s'affichent alors, une seule fois, à copier ou télécharger. Chacun sert une fois à la place du code ; Andal n'en garde que l'empreinte. Plus que trois : la connexion mène à Mon compte pour en refaire.
- **Se connecter** : le mot de passe n'ouvre plus de session, il ouvre une étape de 5 minutes où l'on tape le code (ou un code de secours). Codes à 6 chiffres, pas de 30 secondes, un pas d'écart toléré ; un code déjà servi est refusé. Après 5 codes faux, il faut redonner le mot de passe ; au-delà de 8 échecs en 15 minutes sur le compte, tout est bloqué jusqu'à la fin de la fenêtre.
- **Désactiver** ou **refaire les codes de secours** demande un code valable.
- **Téléphone perdu, plus de code** : un admin de l'espace lève la double authentification depuis l'administration (Comptes → ⋯). La personne est prévenue par email, et l'action est au journal.

**Sessions ouvertes.** La liste des navigateurs connectés : appareil (« Firefox sur macOS »), adresse IP, date d'ouverture, dernière activité, mode de connexion (mot de passe, mot de passe et code, SSO). Chacune se ferme d'un clic, ou toutes les autres d'un coup ; ses pages ouvertes se ferment aussitôt (serveur collab compris). Un admin peut fermer toutes les sessions d'un compte (appareil perdu, départ) sans le désactiver. L'identifiant montré n'est qu'un début d'empreinte : jamais le cookie.

## Annuaire : SSO et SCIM

L'onglet **Annuaire** de l'administration branche Andal sur le fournisseur d'identité de l'entreprise (Okta, Entra ID, Keycloak, authentik…).

**Groupes du SSO.** Avec `OIDC_GROUPS_CLAIM` (souvent `groups`), à chaque connexion SSO la personne entre dans les groupes que nomme son jeton d'identité et sort des autres groupes SSO. Un groupe nommé pour la première fois est créé, marqué « SSO » ; on lui ouvre des volumes depuis le panneau Partager, comme à tout groupe. Le claim est lu dans le jeton d'identité, sinon dans userinfo ; `OIDC_GROUPS_SCOPE` demande un scope en plus (Okta : `groups`). Claim absent : rien ne bouge. Un groupe local qui porte déjà le nom reste intact ; le groupe SSO devient « Nom (SSO) ».

**Provisionnement SCIM 2.0.** Un admin crée le jeton SCIM de l'espace (montré une fois, remplaçable, révocable) et le colle dans le fournisseur, avec l'adresse `WEB_ORIGIN/api/scim/v2`.

- **Comptes** : création (membre de l'espace, sans mot de passe, sans volume : il entre par le SSO), mise à jour du nom et de l'email, désactivation (`active: false`, sessions fermées sur-le-champ), retrait (`DELETE` : le compte est désactivé et sort de l'annuaire SCIM, son historique reste). Un compte retiré puis repoussé retrouve le même compte. Le dernier propriétaire actif ne se désactive pas.
- **Groupes** : création, renommage, membres (ajout, retrait, remplacement), suppression. Ils sont marqués « SCIM » : nom et membres ne se gèrent que dans l'annuaire. Un groupe qui restreint une page ne se supprime pas (même règle que dans l'administration).
- Filtres `userName`, `externalId`, `emails.value`, `displayName` (`eq`), pagination, `excludedAttributes=members`, PATCH des deux formes (avec chemin, façon Entra ID ; sans chemin, façon Okta). Pas de bulk.
- Le jeton SCIM n'ouvre que `/api/scim/v2` : ni session, ni jeton d'API personnel n'y entrent, et lui n'entre nulle part ailleurs. Chaque action est au journal, sans auteur humain.

## Journal d'audit

L'onglet **Journal** de l'administration montre, du plus récent au plus ancien, chaque connexion (et échec), changement de mot de passe, de double authentification et de session, invitation, rôle, groupe, accès et restriction, page, volume, spec, jeton, webhook, synchro Git, réglage de l'assistant et action SCIM : qui, quoi, sur quoi (lien vers la page ou le volume s'ils existent encore), depuis quelle adresse.

- Filtres par action ou famille d'actions, par personne et par dates ; pages de 50.
- **Exporter en CSV** (mêmes filtres, 50 000 lignes au plus), lisible par un tableur ou un SIEM. Les cellules qui ressembleraient à une formule (`=`, `+`, `-`, `@`) sont neutralisées.
- Le journal est en ajout seul : un trigger PostgreSQL refuse toute modification ou suppression, admins compris.

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

## Specs OpenAPI

Un volume range ses specs OpenAPI (3.x, YAML ou JSON), listées dans le sommaire sous « Specs API ». Chacune s'ouvre dans Redoc, version par version : la spec de démo **Paiements** en a deux (2.2 et 2.3).

- **Publier** (droit d'écriture sur le volume) : depuis le sommaire, ou depuis la CI avec un jeton d'API. Une nouvelle version n'est créée que si la spec change vraiment ; republier la même ne fait rien.
- **Bloc OpenAPI** : dans une page, le bouton OpenAPI de la barre choisit une spec et une opération. Le bloc lit la spec vivante : paramètres, corps, réponses, puce de version, lien vers l'opération dans Redoc. Il garde une copie, montrée si la spec disparaît ou si l'opération en sort.
- **Supprimer** une spec : admins du volume. Les blocs qui la citent gardent leur copie.

```bash
curl -X POST "https://docs.example.com/api/projects/<volume>/specs?name=paiements" \
  -H "Authorization: Bearer andal_…" -H "Content-Type: application/yaml" \
  --data-binary @openapi.yaml
```

La page de la spec rappelle cette commande, avec l'identifiant du volume.

## API publique et jetons

Toute l'API de l'interface (`/api/…`) se lit et s'écrit aussi avec un **jeton d'API**, créé dans **Mon compte** (menu du compte) : un nom, une portée (lecture, ou lecture et écriture), une durée (7, 30, 90 ou 365 jours). Le jeton ne s'affiche qu'une fois ; Andal n'en garde qu'une empreinte. Il agit avec vos droits, jamais plus, et se révoque d'un clic.

- Un jeton en lecture ne fait que des `GET`.
- Un jeton ne touche ni aux mots de passe, ni aux comptes et groupes, ni aux jetons, ni aux webhooks, ni à la synchro Git, ni à l'assistant : il faut une session pour cela.
- 20 jetons actifs au plus par personne ; la date de dernière utilisation s'affiche.

Le contenu d'une page s'échange en JSON (le document de l'éditeur) ou en Markdown, et un remplacement arrive en direct chez qui a la page ouverte :

```bash
curl -H "Authorization: Bearer andal_…" "https://docs.example.com/api/pages/<page>/content?format=markdown"
curl -X PUT -H "Authorization: Bearer andal_…" -H "Content-Type: text/markdown" \
  --data-binary @guide.md "https://docs.example.com/api/pages/<page>/content"
curl -X POST -H "Authorization: Bearer andal_…" -H "Content-Type: application/json" \
  -d '{"title":"Notes de version","markdown":"# 2.3\n\n- Jetons plus courts"}' \
  "https://docs.example.com/api/projects/<volume>/pages"
```

Le Markdown suit GFM (tableaux, cases à cocher), plus les encadrés `> [!NOTE]`, les blocs ```` ```mermaid ```` et ```` ```openapi ```` (`spec:` et `operation:`, qui relient le bloc à la spec du volume).

## Intégrations

**Administration → Intégrations** (admins de l'espace) envoie les événements vers d'autres outils : page créée, modifiée, mise à la corbeille, commentaire, spec publiée.

- **Formats** : JSON signé (en-tête `X-Andal-Signature`, HMAC-SHA256 de `horodatage.corps` avec le secret du webhook), Slack ou Mattermost (webhook entrant), Microsoft Teams (carte adaptative).
- **Portée** : tous les volumes, ou un seul ; **événements** au choix. « Tester » envoie un ping ; les 50 derniers envois s'affichent, avec leur réponse.
- Une page modifiée n'est annoncée qu'après `WEBHOOK_UPDATE_DELAY` secondes de calme (120 par défaut) : une séance d'écriture, un message. Une page sous restriction de lecture n'est jamais annoncée.
- Un envoi en échec est retenté jusqu'à 6 tentatives en tout, de 30 secondes à 8 minutes d'écart ; une réponse 4xx (hors 408 et 429) arrête tout de suite. Les adresses du réseau privé sont refusées, résolution DNS comprise, sauf `WEBHOOK_ALLOW_PRIVATE=true`.

**Aperçus de liens** : au survol d'un lien vers un ticket ou une pull request GitHub, ou un ticket Jira, une fiche montre son titre et son état. `GITHUB_TOKEN` ouvre les dépôts privés (sans lui, dépôts publics et 60 requêtes par heure) ; `JIRA_BASE_URL`, `JIRA_EMAIL` et `JIRA_API_TOKEN` branchent Jira.

## Docs-as-code : synchro Git

Dans les réglages d'un volume (admins du volume), **Synchro Git** relie un dossier d'un dépôt au volume : chaque fichier Markdown devient une page, chaque sous-dossier une page parente (son `README.md` ou `index.md` en est le contenu).

- **Titres et ordre** : `title` et `position` de l'en-tête YAML, sinon le premier titre, sinon le nom du fichier ; à défaut de position, l'ordre des noms (`01-demarrer.md`).
- **Liens relatifs** vers d'autres fichiers `.md` : des liens entre pages. **Images** du dépôt : des pièces jointes de la page. Blocs `mermaid` et `openapi` : comme dans l'éditeur.
- Les pages tenues par le dépôt se lisent et se commentent dans Andal, et s'écrivent dans le dépôt : leur bandeau mène au fichier sur la forge. Personne ne les modifie, renomme ou déplace ici, admins compris.
- Un fichier retiré du dépôt met sa page à la corbeille ; une page modifiée garde sa version d'avant dans l'historique, et le changement arrive en direct sur les pages ouvertes.
- **Quand** : à chaque push si la forge appelle le webhook affiché (GitHub, GitLab, Gitea, Forgejo, signé avec le secret affiché), sinon toutes les 10 minutes, ou sur « Synchroniser ».
- Dépôts en `https://` seulement ; un dépôt privé demande un jeton de lecture, gardé côté serveur. **Détacher** laisse les pages en place, et modifiables de nouveau.

## Modèles, export et liens publics

**Modèles de page.** En plus de la page vide, la fenêtre de nouvelle page propose quatre modèles pour équipes tech : **Décision d'architecture** (contexte, options, décision, conséquences), **RFC**, **Runbook** (symptômes, diagnostic, remédiation) et **Post-mortem** (chronologie, cause racine, actions, sans reproche). Le titre commence par le préfixe du modèle (« Décision : », « Runbook : »…), et le contenu est rédigé dans la langue de qui crée la page. Par l'API : `"template": "adr"` (ou `rfc`, `runbook`, `postmortem`) à la création d'une page.

**Exporter.** Le bouton d'export, dans le bandeau de la page, la télécharge :

- **Markdown** : le même Markdown que l'API (GFM, encadrés, blocs `mermaid` et `openapi`), avec des liens vers les pages et les fichiers rendus absolus, vers cette installation.
- **PDF** : mis en page pour l'impression (A4) avec son numéro et son volume, figures et listings numérotés, schémas Mermaid rendus, schémas draw.io et blocs OpenAPI, et numéros de page en pied. Les commentaires restent à l'écart. Le PDF est rendu par [Gotenberg](https://gotenberg.dev) (`GOTENBERG_URL`) ; sans lui, seul le Markdown est proposé.

**Exporter le volume**, dans le menu du volume (le « ⋯ » à côté de son nom), télécharge une archive zip : un fichier Markdown par page (`title` et `position` dans l'en-tête), un dossier par page qui a des sous-pages (son contenu dans `index.md`), des liens relatifs entre pages, et les fichiers utilisés par les pages dans `_fichiers/`. N'y entrent que les pages que vous lisez. L'archive se réimporte telle quelle, ici ou dans un autre Andal.

**Liens publics.** Dans **Partager**, un admin du volume publie une page (avec ou sans ses sous-pages) ou tout le volume derrière une adresse impossible à deviner, `/s/…`. Qui a l'adresse lit sans compte : le contenu des pages publiées, leur numérotation, leurs schémas et leurs fichiers ; ni commentaires, ni historique, ni auteurs.

- Une page restreinte en lecture n'est jamais publique, même par le lien de sa parente ou de son volume ; les liens qui y mènent restent en texte simple, comme ceux vers des pages hors du partage.
- Retirer le lien coupe l'accès aussitôt. Les pages publiques sont marquées `noindex`. Chaque publication et chaque retrait passent au journal d'audit.
- `PUBLIC_LINKS=false` coupe la fonction sur un serveur.

## Importer

**Importer des pages…**, dans le menu du volume, fait entrer toute une arborescence :

- **Markdown** : un fichier `.md`, ou un dossier zippé : un dossier par page parente (son `README.md` ou `index.md`, ou un `Page.md` à côté d'un dossier `Page/`), images et fichiers à côté. Titres et ordre comme pour la synchro Git. L'archive de « Exporter le volume » se réimporte telle quelle.
- **Notion** : l'export « Markdown & CSV », avec les sous-pages. L'arborescence et les encadrés suivent, les bases deviennent des tableaux, et les identifiants que Notion ajoute aux noms disparaissent.
- **Confluence** : l'export HTML d'un espace. L'arborescence vient de l'index de l'export ; les encadrés info, note, avertissement et astuce deviennent des encadrés, le code garde son langage, et tableaux, images et pièces jointes suivent. L'export XML n'est pas pris en charge.

Règles :

- Importer, c'est créer des pages : il faut le droit d'écriture là où elles arrivent (premier niveau du volume, ou sous une page). Elles prennent les droits de cet endroit ; rien n'est remplacé, elles s'ajoutent après les pages existantes.
- Le worker traite l'archive en tâche de fond. La fenêtre suit l'avancée, puis donne le nombre de pages et de fichiers, et les remarques éventuelles (un fichier trop lourd, une page hors schéma). Les liens entre pages importées deviennent des liens entre pages ; images et fichiers deviennent des pièces jointes.
- Limites : `IMPORT_MAX_MB` par archive (200 par défaut) et cinq fois plus une fois déballée, 10 000 fichiers, 2 000 pages, 2 Mo de Markdown par page, `UPLOAD_MAX_MB` par fichier joint. L'archive quitte le stockage une fois l'import terminé, réussi ou non.

```bash
curl -X POST -H "Authorization: Bearer andal_…" -F parentId=<page> -F file=@export.zip \
  "https://docs.example.com/api/projects/<volume>/imports"
```

Avec un jeton en écriture ; `parentId` est facultatif et doit venir avant le fichier. `GET /api/imports/<id>` donne l'avancée.

## Assistant

**⌘K** répond aussi aux questions : une question qui finit par « ? », ou Maj + Entrée. La réponse arrive au fil de l'eau, cite ses sources [1], [2]… et les liste en dessous.

- L'assistant ne lit que les pages que **vous** pouvez lire : la recherche se fait avant, avec vos droits, et seuls ces extraits partent au modèle. Une page restreinte ne quitte jamais Andal pour qui ne la lit pas.
- **Administration → Assistant** (admins de l'espace) choisit le modèle : **Claude** (clé d'API Anthropic, `claude-opus-5-5` par défaut) ou **toute API compatible OpenAI**, locale comprise (Ollama, LM Studio, vLLM) pour que rien ne sorte du réseau. « Tester » vérifie la connexion ; la clé n'est jamais renvoyée au navigateur. Les variables `AI_*` donnent la valeur par défaut.
- 40 questions par heure et par personne.

## Exploitation

**Limite de débit.** Toute l'API est freinée par minute, dans Valkey (partagé par toutes les instances) : 600 lectures et 120 écritures par session ou par jeton (d'API ou SCIM), 120 requêtes par adresse IP sans session. Chaque réponse porte `RateLimit-Limit`, `RateLimit-Remaining` et `RateLimit-Reset` ; au-delà, 429 avec `Retry-After`. La sonde `/api/health` n'est jamais comptée. Réglages : `RATE_LIMIT_READS`, `RATE_LIMIT_WRITES`, `RATE_LIMIT_ANONYMOUS`, ou `RATE_LIMIT=false` derrière une passerelle qui s'en charge. La connexion, la double authentification et l'assistant gardent en plus leurs freins propres.

**Adresse du client.** L'API ne croit `X-Forwarded-For` que venant d'un proxy de confiance : `TRUST_PROXY` (par défaut `loopback,uniquelocal`, soit la machine et les réseaux privés, où vit le Caddy du compose). Derrière un autre proxy ou un équilibreur, donnez son adresse ou son réseau (`10.0.0.0/8`). Sans cela, n'importe qui pourrait se donner l'adresse de son choix et contourner les freins par adresse.

**Plusieurs instances collab.** L'extension Redis de Hocuspocus synchronise par Valkey les documents ouverts sur plusieurs instances, et un verrou n'en laisse qu'une enregistrer. Les annonces de l'API (droits, sommaire, notifications) arrivent à toutes ; les écritures qu'elle demande (ancre de commentaire, restauration, contenu par l'API ou la synchro Git) passent par une file Valkey : une seule instance prend chacune, et l'abandonne si plus personne n'attend la réponse. En production : `docker compose … up -d --scale collab=3`, Caddy retrouve les instances par le DNS.

**Enregistrement refusé.** Quand le serveur collab refuse un contenu (hors schéma), les éditeurs ouverts sur la page voient aussitôt un bandeau : rien n'est enregistré tant qu'il reste là. Il disparaît dès qu'un enregistrement repasse, quelle que soit l'instance.

**Langues.** L'interface existe en français et en anglais : la langue du navigateur par défaut, puis le choix fait dans Mon compte ou en haut de l'écran de connexion ; le compte suit la langue de l'interface où il sert, et les emails avec. Les erreurs de l'API suivent `Accept-Language`, et les emails la langue de leur destinataire (celle de l'admin qui invite, pour une invitation). Le français est la langue source : une phrase sert de clé, et le catalogue anglais est dans `apps/web/src/i18n/en/` (interface) et `packages/db/src/i18n-en.ts` (serveur).

## Organisation

```
apps/
  web/      React 19, Vite, Tailwind 4, TanStack Router et Query, TipTap 3
  api/      NestJS 11 sur Fastify; fichiers vers le stockage S3
  collab/   Hocuspocus 3 (Yjs), validation du schéma avant écriture
  worker/   BullMQ: texte et liens pour la recherche et les rétroliens, emails, purges (corbeille, fichiers), webhooks, synchro Git, imports
packages/
  authz/    Modèle de droits, pur et testé
  db/       Kysely, migrations, seed, requêtes d'accès, stockage S3
  editor/   Schéma TipTap partagé client / serveur (Mermaid, OpenAPI, draw.io, image, pièce jointe, tableau, tâches, encadré, commentaire), lecture des specs OpenAPI, Markdown aller-retour, modèles de page, rendu HTML pour le PDF
  ui/       Jetons de design (CSS) et composants de base
deploy/     Images, compose de production, Caddy (voir deploy/README.fr.md)
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

Lance les tests du modèle de droits, du schéma de l'éditeur (specs OpenAPI, Markdown), des webhooks (signature, garde réseau), des codes à usage unique (vecteurs de la RFC 6238) et de la traduction des messages du serveur.

```bash
tests/e2e/run.sh
```

Avec la stack lancée : les suites de bout en bout (comptes, accès et notifications, pages, versions, volumes, fichiers et liens, specs, API publique et webhooks, synchro Git, modèles, exports, liens publics et imports, assistant, double authentification, sessions et journal, SCIM et groupes SSO, limite de débit), puis les trois vérifications du serveur collab ci-dessous. Chaque suite repart des données de démo ; `tests/e2e/run.sh files_links_test` n'en lance qu'une. La CI GitHub les fait tourner à chaque commit, sur une stack complète.

```bash
pnpm --filter @andal/collab check:readonly
```

Avec la stack lancée : se connecte au serveur collab en tant que Léa, tente une écriture brute dans le document Yjs, et vérifie que la base n'a pas bougé. `check:readonly aminata` fait la contre-épreuve : l'écriture passe. Relancez `pnpm db:seed` ensuite pour nettoyer.

```bash
pnpm --filter @andal/collab check:live-access
```

Avec la stack lancée : Aminata écrit sur « Glossaire » par une connexion ouverte, puis Camille lui retire l'écriture, puis la lecture. Vérifie que la même connexion passe en lecture seule, puis qu'elle est fermée. Ensuite Camille archive le volume Paiements pendant qu'Aminata a « Conventions » ouverte : la page passe en lecture seule, puis redevient modifiable au désarchivage. Relancez `pnpm db:seed` ensuite.

```bash
pnpm --filter @andal/collab check:multi
```

Avec la stack lancée : démarre une seconde instance collab (port 3012) et vérifie qu'une modification faite sur l'une arrive aux navigateurs de l'autre, qu'une écriture par l'API n'est faite qu'une fois (une seule version) et qu'un contenu refusé est signalé aux éditeurs des deux instances, puis la reprise de l'enregistrement.

## Déployer

Images Docker, compose de production derrière Caddy (TLS automatique, CSP stricte), premier compte, sauvegardes et mises à jour : voir [deploy/README.fr.md](deploy/README.fr.md). La CI publie `ghcr.io/open226bf/andal-server` et `andal-web` à chaque commit sur `main` (étiquette `edge`) et à chaque version `v*` (étiquettes `0.1.0`, `0.1` et `latest` pour `v0.1.0`).

```bash
pnpm --filter @andal/collab check:deploy
```

Avec `ANDAL_URL`, `ANDAL_USER` et `ANDAL_PASSWORD` : vérifie une installation déployée, de HTTPS à la collaboration temps réel.

## Ce qui reste à faire

- **Comptes** : clés d'accès (WebAuthn, passkeys) en plus des codes à usage unique ; un réglage d'espace pour rendre la double authentification obligatoire.
- **Annuaire** : SCIM ne gère ni les rôles d'espace ni les volumes (on ouvre des volumes aux groupes) ; pas de bulk.
- **Gestion des accès** : un réglage d'espace pour réserver la création de volumes aux admins (`canCreateProject` le prévoit déjà) ; une rétention réglable du journal d'audit.
- **Commentaires** : modification d'un message déjà envoyé, création de fil sur mobile à éprouver sur un vrai téléphone.
- **Notifications** : une notification qui arrive pendant l'envoi de l'email groupé attend l'email suivant ; pas encore de notification pour les modifications de pages suivies.
- **Bibliothèque** : ordonner son étagère à la main (aujourd'hui par numéro de volume) ; glisser un volume d'un rayon à l'autre depuis la bibliothèque.
- **Pages** : comparer deux versions (aujourd'hui on les regarde l'une après l'autre) ; replier les sections du sommaire.
- **Fichiers** : les schémas draw.io sont encore stockés en data URI dans le document, pas dans le stockage.
- **Specs** : comparer deux versions d'une spec (routes ajoutées, retirées, cassées) ; des specs AsyncAPI ou GraphQL.
- **Synchro Git** : dans un seul sens (dépôt → Andal) ; proposer une modification depuis Andal ouvrirait une pull request.
- **Assistant** : la recherche est plein texte (français) ; une recherche sémantique (embeddings, pgvector) trouverait mieux les questions mal formulées.
- **Migration** : l'export XML de Confluence ne s'importe pas, ni les commentaires et l'historique venus de Confluence ou de Notion ; les bases Notion arrivent en tableaux figés ; un lien public n'a ni date d'expiration ni mot de passe ; pas encore de PDF d'un volume entier.
- **Montée en charge** : plusieurs instances de l'API derrière Caddy (elle est déjà sans état : sessions, freins et files dans Valkey).
- **Durcissement** : RLS PostgreSQL en seconde barrière ; chiffrer en base les secrets de double authentification et les clés des intégrations.
- **Langues** : le contenu de démo et les messages de l'API SCIM restent en français ; d'autres langues demandent un catalogue de plus.
- **Performance** : le bundle principal fait environ 1,1 Mo minifié ; charger l'éditeur à la demande en mode lecture.
- **Choix à trancher** : la numérotation est calculée sur toutes les pages pour rester stable entre lecteurs. Une personne qui ne voit pas 4.1 voit donc « 4.2 Astreinte » et peut en déduire qu'une page 4.1 existe.

## Licence

Apache-2.0, voir [LICENSE](LICENSE).
