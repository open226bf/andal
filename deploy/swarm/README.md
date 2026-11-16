# Deploying Andal on Docker Swarm

[Français](README.fr.md) · **English**

The same images and the same `deploy/.env` as the [single-server deployment](../README.md), spread over a Swarm cluster. This guide covers what changes; the stack is in [stack.yaml](stack.yaml).

```
browser ──HTTPS──▶ web (Caddy) ──▶ api, collab ×N, worker ──▶ postgres, valkey, rustfs
                   edge node        drawio, gotenberg          data node
                   ports 80/443     any node                   local volumes
                   └──────────── overlay network andal_backend ───────────┘
```

## What changes from Docker Compose

- **Volumes stay on their node.** Swarm does not move a volume when it moves a service. Postgres, Valkey and RustFS are therefore pinned to the node labeled `andal-data`, and `web`, which keeps its TLS certificates, to the node labeled `andal-edge`. One node can carry both labels.
- **No startup order.** Swarm cannot make one service wait for another. `migrate` is a job that retries until Postgres answers; on the first install, the API, collab and the worker restart a few times until the database is ready. For upgrades, the migration runs on its own first (see [Upgrading](#upgrading)).
- **Ports in host mode.** `web` publishes 80 and 443 directly on the edge node, so Caddy sees visitors' real addresses. Through Swarm's routing mesh, every request would appear to come from the same internal address and share a single rate limit.
- **Variables.** `docker stack deploy` does not read `.env` files: you load `deploy/.env` into the shell first. The values end up in the service definitions, readable by anyone with access to a manager (`docker service inspect`). Andal does not read Docker secrets yet.

## Requirements

- A Swarm cluster on Docker 24 or later. The commands below run on a manager, from a copy of the repository.
- Swarm ports open between nodes: 2377/tcp to the managers, 7946/tcp and udp, 4789/udp.
- A domain name pointing to the edge node, with ports 80 and 443 (tcp and udp) open on it.
- Nodes that can pull images from ghcr.io and Docker Hub, or an internal registry that mirrors them (`ANDAL_IMAGE`, `ANDAL_WEB_IMAGE` in `deploy/.env`). `--with-registry-auth` passes the manager's registry credentials on to the nodes.

## Install

Label the node that keeps the data, and the one the domain points to:

```bash
docker node update --label-add andal-data=true <data-node>
```

```bash
docker node update --label-add andal-edge=true <edge-node>
```

On a single-node Swarm, give it both labels.

```bash
git clone https://github.com/open226bf/andal.git && cd andal
```

```bash
cp deploy/.env.example deploy/.env
```

Fill in `deploy/.env` as for Compose: `ANDAL_DOMAIN`, a strong secret for `POSTGRES_PASSWORD` and `S3_SECRET_KEY` (`openssl rand -base64 32`), and `SMTP_URL` and `MAIL_FROM` for email. The shell reads this file: put values that contain spaces in quotes (like `MAIL_FROM`), and avoid `$` in them.

Load the variables into the shell (nothing is printed), then deploy:

```bash
set -a; . deploy/.env; set +a
```

```bash
docker stack deploy -c deploy/swarm/stack.yaml --with-registry-auth --detach=false andal
```

`--detach=false` waits until every service has started. To check on them:

```bash
docker stack services andal
```

`migrate` shows `0/1 (1/1 completed)` once the database is up to date. Its first attempts fail while Postgres starts, and the API, collab and the worker restart once or twice before it completes: that is expected. The file bucket is created the first time the API starts.

## First account

A command inside a container runs on the node that hosts it: `docker service ps andal_api` names that node. There:

```bash
docker exec -it $(docker ps -q -f name=andal_api. | head -n1) andal user add
```

The first account created becomes the workspace owner. Further accounts are invited by email from Administration.

## Scaling

- **collab**: set `COLLAB_REPLICAS=3` in `deploy/.env`, then deploy again. The instances sync through Valkey; Caddy finds each one through DNS (`endpoint_mode: dnsrr`) and spreads the WebSockets across them. Avoid `docker service scale` here: the next deploy would reset the count.
- **api** and **worker**: one instance each. Running several API instances is still on the roadmap.
- **drawio** and **gotenberg** run on any node; one instance of each is enough.

## Backups

The database and the files, both on the data node. There:

```bash
docker exec $(docker ps -q -f name=andal_postgres.) pg_dump -U andal -Fc andal > andal-$(date +%F).dump
```

```bash
docker run --rm -v andal_files:/data:ro -v "$PWD":/backup alpine tar czf /backup/andal-fichiers-$(date +%F).tgz -C /data .
```

To restore the database, first stop the services that write to it (on a manager):

```bash
docker service scale andal_api=0 andal_collab=0 andal_worker=0
```

Then on the data node:

```bash
docker exec -i $(docker ps -q -f name=andal_postgres.) pg_restore -U andal -d andal --clean --if-exists < andal-YYYY-MM-DD.dump
```

Deploy again to bring the services back up.

## Upgrading

Back up, set `ANDAL_VERSION` in `deploy/.env` to the new version (see [CHANGELOG.md](../../CHANGELOG.md)), then on a manager:

```bash
set -a; . deploy/.env; set +a
```

First the migration on its own, with the new version. The command returns once it has finished:

```bash
docker service update --image "${ANDAL_IMAGE:-ghcr.io/open226bf/andal-server}:${ANDAL_VERSION}" --with-registry-auth andal_migrate
```

Then everything else:

```bash
docker stack deploy -c deploy/swarm/stack.yaml --with-registry-auth --detach=false andal
```

The API starts its new instance before stopping the old one, and rolls back if the new one never becomes healthy. The migration job runs again and finds nothing left to do.

## Variants

- **External S3** (MinIO, Garage, Scaleway, R2, …): set `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` and the keys, then remove the `rustfs` service from `stack.yaml`. Files then no longer depend on the data node.
- **Encrypted overlay network**: if the nodes talk over a network you do not trust, add `driver_opts: { encrypted: "true" }` to the `backend` network. Swarm then encrypts the traffic between nodes with IPsec; the ESP protocol (IP protocol 50) must be allowed between them.
- **Behind an existing proxy** (Traefik on the cluster, for example): remove the `ports` and the placement of `web`, attach it to the proxy's network, and route the domain to its port 80. Caddy then serves plain HTTP: set `ANDAL_DOMAIN: ":80"` in the `environment` of `web` only, and keep the public domain in `deploy/.env` (the API derives its address from it). One limit for now: Caddy does not trust the `X-Forwarded-For` header sent by that proxy, so every request appears to come from the proxy and shares the same per-address rate limit, sign-in included. Put Caddy at the edge whenever you can.
- **Imports**: the worker unpacks archives on the disk of its node. Allow five times `IMPORT_MAX_MB` of free space there.
- Everything else (SSO, SCIM, assistant, webhooks, Git sync, PDF export, public links) is configured as in [the main guide](../README.md#variants).

## Removing

```bash
docker stack rm andal
```

The volumes stay on their nodes (`andal_postgres`, `andal_valkey`, `andal_files`, `andal_caddy`): deploying again picks up the same data.
