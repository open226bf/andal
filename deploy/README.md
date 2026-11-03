# Deploying Andal

[Français](README.fr.md) · **English**

A Linux server with Docker is all you need: Caddy obtains the TLS certificate, serves the UI, and proxies the API, real-time collaboration and draw.io on the same domain. Postgres, Valkey and RustFS run alongside, each with its own volume.

```
browser ──HTTPS──▶ web (Caddy) ──▶ /api      api      ─┐
                                ──▶ /collab   collab   ─┼─▶ postgres, valkey, rustfs
                                ──▶ /drawio   drawio    │
                                              worker   ─┘   (indexing, emails, purges, webhooks, Git sync)
```

## Install

Requirements: Docker 24 or later with the compose plugin, a domain name pointing to the server, and ports 80 and 443 open.

```bash
git clone https://github.com/open226bf/andal.git && cd andal
```

```bash
cp deploy/.env.example deploy/.env
```

Fill in `deploy/.env`: `ANDAL_DOMAIN`, and a strong secret for `POSTGRES_PASSWORD` and `S3_SECRET_KEY` (`openssl rand -base64 32`). For email, set `SMTP_URL` and `MAIL_FROM`.

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
```

On startup, the `migrate` service updates the database and then exits; the API, the collab server and the worker wait for it to succeed. The file bucket is created the first time the API starts.

To build the images locally instead of pulling them, add `--build`.

## First account

The first account created becomes the workspace owner:

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env exec api andal user add
```

Further accounts are invited by email from Administration.

## Backups

There are two things to back up: the database and the files.

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T postgres pg_dump -U andal -Fc andal > andal-$(date +%F).dump
```

```bash
docker run --rm -v andal_files:/data:ro -v "$PWD":/backup alpine tar czf /backup/andal-fichiers-$(date +%F).tgz -C /data .
```

To restore the database into a fresh installation (all services stopped except postgres):

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T postgres pg_restore -U andal -d andal --clean --if-exists < andal-YYYY-MM-DD.dump
```

## Upgrading

Set `ANDAL_VERSION` to the new tag (or keep `latest`), then:

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env pull
```

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
```

Migrations run automatically before the services restart. Back up before a major upgrade.

## Variants

- **External S3** (MinIO, Garage, Scaleway, R2, …): set `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` and the keys, then remove the `rustfs` service from the compose file.
- **SSO**: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. The redirect URI to register with the provider is `https://<ANDAL_DOMAIN>/api/auth/callback`. To keep the provider's groups in sync on every sign-in: `OIDC_GROUPS_CLAIM=groups` (plus `OIDC_GROUPS_SCOPE=groups` for Okta).
- **SCIM** (accounts and groups pushed by Okta, Entra ID, …): create the token in Administration → Directory, and register `https://<ANDAL_DOMAIN>/api/scim/v2` with the provider.
- **Multiple collab instances**: `docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --scale collab=3`. They sync through Valkey; Caddy finds them through DNS and spreads the WebSockets across them.
- **Local trial** alongside other services: `ANDAL_DOMAIN=localhost`, `HTTP_PORT=58880`, `HTTPS_PORT=58443`, `ANDAL_ORIGIN=https://localhost:58443`. Caddy then signs with its own local authority, so the browser asks you to accept the certificate.
- **Behind another reverse proxy**: publish only port 80 of the `web` service and let the proxy terminate TLS; `ANDAL_ORIGIN` stays the public `https://` address. If that proxy is not on a private network, put its address in `TRUST_PROXY`; otherwise every request will appear to come from it (and share the same per-address rate limit). Let streamed responses (`text/event-stream`) through without buffering: that is how the assistant answers.
- **Assistant**: `AI_PROVIDER=anthropic` and `AI_API_KEY` for Claude; `AI_PROVIDER=openai`, `AI_BASE_URL` and `AI_MODEL` for an OpenAI-compatible model, including a local one (Ollama on the host: `AI_BASE_URL=http://host.docker.internal:11434/v1`, with `extra_hosts: ["host.docker.internal:host-gateway"]` on the `api` service). Admins can also configure it in the UI.
- **GitHub and Jira previews**: `GITHUB_TOKEN` (read-only is enough), `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.
- **Webhooks to the internal network** (Mattermost on the LAN, for example): `WEBHOOK_ALLOW_PRIVATE=true`. By default, Andal refuses to call a private address, so that a webhook cannot be used to probe the server's network.
- **Git sync**: the worker clones repositories over `https://`, so it needs outbound access to the Git host (GitHub, GitLab, Gitea, …). For a sync on every push, the Git host must be able to reach `https://<ANDAL_DOMAIN>/api/git/hooks/…`.

## Security

- Only Caddy is exposed; the other services publish no ports.
- Rate limiting on the whole API (`RATE_LIMIT_*`), with dedicated limits on sign-in and two-factor authentication; the API trusts `X-Forwarded-For` only from `TRUST_PROXY`.
- `Secure` and `HttpOnly` session cookies, strict CSP on the UI, uploaded files served under `CSP: sandbox`.
- Secrets live only in `deploy/.env`, never in the images. API tokens are stored only as hashes; assistant keys and repository tokens stay on the server and are never sent back to the browser.
