# Déployer Andal

**Français** · [English](README.md)

Un serveur Linux avec Docker suffit : Caddy obtient le certificat TLS, sert l'interface, et relaie l'API, la collaboration temps réel et draw.io sur le même domaine. Postgres, Valkey et RustFS tournent à côté, chacun avec son volume, ainsi que Gotenberg, qui rend les exports PDF.

```
navigateur ──HTTPS──▶ web (Caddy) ──▶ /api      api      ─┐
                                   ──▶ /collab   collab   ─┼─▶ postgres, valkey, rustfs
                                   ──▶ /drawio   drawio    │
                                                 worker   ─┘   (indexation, emails, purges, webhooks, synchro Git, imports)
```

## Installer

Prérequis : Docker 24 ou plus avec le plugin compose, un nom de domaine qui pointe vers le serveur, les ports 80 et 443 ouverts.

```bash
git clone https://github.com/open226bf/andal.git && cd andal
```

```bash
cp deploy/.env.example deploy/.env
```

Remplissez `deploy/.env` : `ANDAL_DOMAIN`, et un secret fort pour `POSTGRES_PASSWORD` et `S3_SECRET_KEY` (`openssl rand -base64 32`). Pour les emails, renseignez `SMTP_URL` et `MAIL_FROM`.

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
```

Au démarrage, le service `migrate` met la base à jour puis s'arrête ; l'API, le serveur collab et le worker attendent qu'il ait réussi. Le bucket de fichiers est créé au premier démarrage de l'API.

Pour construire les images sur place plutôt que de les télécharger, ajoutez `--build`.

## Premier compte

Le premier compte créé devient propriétaire de l'espace :

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env exec api andal user add
```

Les suivants s'invitent depuis l'administration, par email.

## Sauvegarder

Deux choses à sauvegarder : la base et les fichiers.

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T postgres pg_dump -U andal -Fc andal > andal-$(date +%F).dump
```

```bash
docker run --rm -v andal_files:/data:ro -v "$PWD":/backup alpine tar czf /backup/andal-fichiers-$(date +%F).tgz -C /data .
```

Restaurer la base dans une installation neuve (services arrêtés sauf postgres) :

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T postgres pg_restore -U andal -d andal --clean --if-exists < andal-AAAA-MM-JJ.dump
```

## Mettre à jour

Fixez `ANDAL_VERSION` sur la nouvelle version, sans le `v` (`0.1.0`, ou `0.1` pour suivre ses correctifs), ou gardez `latest`. Ce que change chaque version est dans [CHANGELOG.fr.md](../CHANGELOG.fr.md). Puis :

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env pull
```

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
```

Les migrations passent toutes seules avant le redémarrage des services. Sauvegardez avant une mise à jour majeure.

## Variantes

- **S3 externe** (MinIO, Garage, Scaleway, R2…) : renseignez `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` et les clés, puis supprimez le service `rustfs` du compose.
- **SSO** : `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. L'URL de retour à déclarer chez le fournisseur est `https://<ANDAL_DOMAIN>/api/auth/callback`. Pour que les groupes du fournisseur suivent à chaque connexion : `OIDC_GROUPS_CLAIM=groups` (et `OIDC_GROUPS_SCOPE=groups` chez Okta).
- **SCIM** (comptes et groupes poussés par Okta, Entra ID…) : créez le jeton dans Administration → Annuaire, et déclarez `https://<ANDAL_DOMAIN>/api/scim/v2` chez le fournisseur.
- **Plusieurs instances collab** : `docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --scale collab=3`. Elles se synchronisent par Valkey ; Caddy les retrouve par le DNS et répartit les WebSockets.
- **Essai local** à côté d'autres services : `ANDAL_DOMAIN=localhost`, `HTTP_PORT=58880`, `HTTPS_PORT=58443`, `ANDAL_ORIGIN=https://localhost:58443`. Caddy signe alors avec sa propre autorité locale : le navigateur demande d'accepter le certificat.
- **Derrière un autre reverse proxy** : publiez seulement le port 80 du service `web` et laissez le proxy terminer TLS ; `ANDAL_ORIGIN` reste l'adresse publique en `https://`. Si ce proxy n'est pas sur un réseau privé, donnez son adresse dans `TRUST_PROXY`, sinon toutes les requêtes sembleront venir de lui (et partager la même limite de débit par adresse). Laissez passer les réponses en flux (`text/event-stream`) sans tampon : l'assistant répond ainsi.
- **Assistant** : `AI_PROVIDER=anthropic` et `AI_API_KEY` pour Claude ; `AI_PROVIDER=openai`, `AI_BASE_URL` et `AI_MODEL` pour un modèle compatible OpenAI, local compris (Ollama sur l'hôte : `AI_BASE_URL=http://host.docker.internal:11434/v1`, avec `extra_hosts: ["host.docker.internal:host-gateway"]` sur le service `api`). Les admins peuvent aussi le régler dans l'interface.
- **Aperçus GitHub et Jira** : `GITHUB_TOKEN` (lecture seule suffit), `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.
- **Webhooks vers le réseau interne** (Mattermost sur le LAN, par exemple) : `WEBHOOK_ALLOW_PRIVATE=true`. Par défaut, Andal refuse d'appeler une adresse privée, pour qu'un webhook ne serve pas à sonder le réseau du serveur.
- **Synchro Git** : le worker clone les dépôts en `https://` ; il lui faut une sortie vers la forge (GitHub, GitLab, Gitea…). Pour une synchro à chaque push, la forge doit joindre `https://<ANDAL_DOMAIN>/api/git/hooks/…`.
- **Export PDF** : le service `gotenberg` rend les PDF pour l'API, sans port publié. Pour s'en passer, mettez `GOTENBERG_URL=` (vide) dans `deploy/.env` et retirez le service ; le menu d'export ne propose alors que le Markdown.
- **Imports** : `IMPORT_MAX_MB` (200 par défaut) plafonne chaque archive. Le worker la déballe dans son dossier temporaire : prévoyez jusqu'à cinq fois cette taille d'espace disque libre.
- **Liens publics** : `PUBLIC_LINKS=false` les interdit, et ceux déjà publiés cessent aussitôt de répondre.

## Sécurité

- Seul Caddy est exposé ; les autres services n'ont aucun port publié.
- Limite de débit sur toute l'API (`RATE_LIMIT_*`), freins dédiés sur la connexion et la double authentification ; l'API ne croit `X-Forwarded-For` que venant de `TRUST_PROXY`.
- Cookies de session `Secure` et `HttpOnly`, CSP stricte sur l'interface, fichiers envoyés servis sous `CSP: sandbox`.
- Les liens publics (`/s/…`) reposent sur un jeton aléatoire de 144 bits, ne montrent jamais une page restreinte en lecture, et sont servis en `noindex`.
- Les secrets ne vivent que dans `deploy/.env`, jamais dans les images. Les jetons d'API ne sont gardés qu'en empreinte ; les clés de l'assistant et les jetons des dépôts restent côté serveur, jamais renvoyés au navigateur.
