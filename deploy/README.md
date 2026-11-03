# Déployer Andal

Un serveur Linux avec Docker suffit : Caddy obtient le certificat TLS, sert l'interface, et relaie l'API, la collaboration temps réel et draw.io sur le même domaine. Postgres, Valkey et RustFS tournent à côté, chacun avec son volume.

```
navigateur ──HTTPS──▶ web (Caddy) ──▶ /api      api      ─┐
                                   ──▶ /collab   collab   ─┼─▶ postgres, valkey, rustfs
                                   ──▶ /drawio   drawio    │
                                                 worker   ─┘   (indexation, emails, purges, webhooks, synchro Git)
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

Fixez `ANDAL_VERSION` sur la nouvelle étiquette (ou gardez `latest`), puis :

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env pull
```

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
```

Les migrations passent toutes seules avant le redémarrage des services. Sauvegardez avant une mise à jour majeure.

## Variantes

- **S3 externe** (MinIO, Garage, Scaleway, R2…) : renseignez `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` et les clés, puis supprimez le service `rustfs` du compose.
- **SSO** : `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. L'URL de retour à déclarer chez le fournisseur est `https://<ANDAL_DOMAIN>/api/auth/callback`.
- **Essai local** à côté d'autres services : `ANDAL_DOMAIN=localhost`, `HTTP_PORT=58880`, `HTTPS_PORT=58443`, `ANDAL_ORIGIN=https://localhost:58443`. Caddy signe alors avec sa propre autorité locale : le navigateur demande d'accepter le certificat.
- **Derrière un autre reverse proxy** : publiez seulement le port 80 du service `web` et laissez le proxy terminer TLS ; `ANDAL_ORIGIN` reste l'adresse publique en `https://`. Laissez passer les réponses en flux (`text/event-stream`) sans tampon : l'assistant répond ainsi.
- **Assistant** : `AI_PROVIDER=anthropic` et `AI_API_KEY` pour Claude ; `AI_PROVIDER=openai`, `AI_BASE_URL` et `AI_MODEL` pour un modèle compatible OpenAI, local compris (Ollama sur l'hôte : `AI_BASE_URL=http://host.docker.internal:11434/v1`, avec `extra_hosts: ["host.docker.internal:host-gateway"]` sur le service `api`). Les admins peuvent aussi le régler dans l'interface.
- **Aperçus GitHub et Jira** : `GITHUB_TOKEN` (lecture seule suffit), `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.
- **Webhooks vers le réseau interne** (Mattermost sur le LAN, par exemple) : `WEBHOOK_ALLOW_PRIVATE=true`. Par défaut, Andal refuse d'appeler une adresse privée, pour qu'un webhook ne serve pas à sonder le réseau du serveur.
- **Synchro Git** : le worker clone les dépôts en `https://` ; il lui faut une sortie vers la forge (GitHub, GitLab, Gitea…). Pour une synchro à chaque push, la forge doit joindre `https://<ANDAL_DOMAIN>/api/git/hooks/…`.

## Sécurité

- Seul Caddy est exposé ; les autres services n'ont aucun port publié.
- Cookies de session `Secure` et `HttpOnly`, CSP stricte sur l'interface, fichiers envoyés servis sous `CSP: sandbox`.
- Les secrets ne vivent que dans `deploy/.env`, jamais dans les images. Les jetons d'API ne sont gardés qu'en empreinte ; les clés de l'assistant et les jetons des dépôts restent côté serveur, jamais renvoyés au navigateur.
