# syntax=docker/dockerfile:1.7
#
# Deux images depuis le même build:
#   --target server   API, serveur collab, worker et scripts de base (une commande par service)
#   --target web      l'interface, servie par Caddy, qui relaie /api, /collab et /drawio
#
# docker build --target server -t andal-server .
# docker build --target web -t andal-web .

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# La version de package.json (packageManager); corepack est retiré des versions récentes de Node.
RUN npm install --global pnpm@11.23.0
WORKDIR /app

# ---------- Dépendances, puis build de tout le monorepo ----------
FROM base AS build
# Adresse de draw.io vue du navigateur; en production, Caddy le sert sous /drawio.
ARG VITE_DRAWIO_URL=/drawio
ENV VITE_DRAWIO_URL=$VITE_DRAWIO_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/collab/package.json apps/collab/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/authz/package.json packages/authz/
COPY packages/db/package.json packages/db/
COPY packages/editor/package.json packages/editor/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM build AS prune
# Seulement les dépendances d'exécution pour l'image serveur; ni sources ni web.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --offline \
 && rm -rf apps/web packages/ui apps/*/src packages/*/src apps/collab/scripts

# ---------- Image serveur ----------
FROM node:${NODE_VERSION}-bookworm-slim AS server
ENV NODE_ENV=production HOST=0.0.0.0
# git: la synchro des volumes avec un dépôt (worker).
RUN apt-get update \
 && apt-get install --yes --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prune --chown=node:node /app /app
USER node
# Commandes: api (défaut), collab, worker, migrate, user.
COPY --chown=node:node deploy/entrypoint.sh /usr/local/bin/andal
ENTRYPOINT ["andal"]
CMD ["api"]
LABEL org.opencontainers.image.source="https://github.com/open226bf/andal" \
      org.opencontainers.image.description="Andal: API, serveur collab, worker" \
      org.opencontainers.image.licenses="Apache-2.0"

# ---------- Image web ----------
FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
LABEL org.opencontainers.image.source="https://github.com/open226bf/andal" \
      org.opencontainers.image.description="Andal: interface web derrière Caddy (TLS automatique)" \
      org.opencontainers.image.licenses="Apache-2.0"
