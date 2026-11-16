# Déployer Andal sur Docker Swarm

**Français** · [English](README.md)

Les mêmes images et le même `deploy/.env` que le [déploiement sur un serveur](../README.fr.md), répartis sur un cluster Swarm. Ce guide dit ce qui change ; la stack est dans [stack.yaml](stack.yaml).

```
navigateur ──HTTPS──▶ web (Caddy)   ──▶ api, collab ×N, worker ──▶ postgres, valkey, rustfs
                      nœud d'entrée      drawio, gotenberg          nœud des données
                      ports 80/443       n'importe quel nœud        volumes locaux
                      └──────────── réseau overlay andal_backend ─────────────┘
```

## Ce qui change par rapport à Docker Compose

- **Les volumes restent sur leur nœud.** Swarm ne déplace pas un volume quand il déplace un service. Postgres, Valkey et RustFS sont donc attachés au nœud étiqueté `andal-data`, et `web`, qui garde ses certificats TLS, au nœud étiqueté `andal-edge`. Un même nœud peut porter les deux étiquettes.
- **Pas d'ordre de démarrage.** Swarm ne sait pas faire attendre un service par un autre. `migrate` est une tâche (job) qui réessaie jusqu'à ce que Postgres réponde ; à la première installation, l'API, collab et le worker redémarrent quelques fois, le temps que la base soit prête. Pour les mises à jour, la migration passe d'abord seule (voir [Mettre à jour](#mettre-à-jour)).
- **Ports en mode host.** `web` publie 80 et 443 directement sur le nœud d'entrée : Caddy voit l'adresse réelle des visiteurs. À travers le maillage de routage de Swarm, toutes les requêtes sembleraient venir de la même adresse interne et partageraient une seule limite de débit.
- **Variables.** `docker stack deploy` ne lit pas les fichiers `.env` : on charge `deploy/.env` dans le shell avant. Les valeurs se retrouvent dans la définition des services, lisibles par qui a accès à un manager (`docker service inspect`). Andal ne lit pas encore les secrets Docker.

## Prérequis

- Un cluster Swarm sous Docker 24 ou plus. Les commandes ci-dessous se lancent sur un manager, depuis une copie du dépôt.
- Les ports de Swarm ouverts entre les nœuds : 2377/tcp vers les managers, 7946/tcp et udp, 4789/udp.
- Un nom de domaine qui pointe vers le nœud d'entrée, avec les ports 80 et 443 (tcp et udp) ouverts.
- Des nœuds qui peuvent télécharger les images sur ghcr.io et Docker Hub, ou un registre interne qui les reprend (`ANDAL_IMAGE`, `ANDAL_WEB_IMAGE` dans `deploy/.env`). `--with-registry-auth` transmet aux nœuds les identifiants de registre du manager.

## Installer

Étiquetez le nœud qui garde les données, et celui vers lequel pointe le domaine :

```bash
docker node update --label-add andal-data=true <nœud-données>
```

```bash
docker node update --label-add andal-edge=true <nœud-entrée>
```

Sur un Swarm d'un seul nœud, donnez-lui les deux étiquettes.

```bash
git clone https://github.com/open226bf/andal.git && cd andal
```

```bash
cp deploy/.env.example deploy/.env
```

Remplissez `deploy/.env` comme pour Compose : `ANDAL_DOMAIN`, un secret fort pour `POSTGRES_PASSWORD` et `S3_SECRET_KEY` (`openssl rand -base64 32`), et `SMTP_URL` et `MAIL_FROM` pour les emails. C'est le shell qui lit ce fichier : mettez entre guillemets les valeurs qui contiennent des espaces (comme `MAIL_FROM`), et évitez-y le `$`.

Chargez les variables dans le shell (rien ne s'affiche), puis déployez :

```bash
set -a; . deploy/.env; set +a
```

```bash
docker stack deploy -c deploy/swarm/stack.yaml --with-registry-auth --detach=false andal
```

`--detach=false` attend que chaque service ait démarré. Pour les suivre :

```bash
docker stack services andal
```

`migrate` affiche `0/1 (1/1 completed)` une fois la base à jour. Ses premiers essais échouent pendant que Postgres démarre, et l'API, collab et le worker redémarrent une ou deux fois avant qu'il ait fini : c'est normal. Le bucket de fichiers est créé au premier démarrage de l'API.

## Premier compte

Une commande dans un conteneur se lance sur le nœud qui l'héberge : `docker service ps andal_api` donne ce nœud. Là :

```bash
docker exec -it $(docker ps -q -f name=andal_api. | head -n1) andal user add
```

Le premier compte créé devient propriétaire de l'espace. Les comptes suivants s'invitent par email depuis l'Administration.

## Monter en charge

- **collab** : `COLLAB_REPLICAS=3` dans `deploy/.env`, puis déployez de nouveau. Les instances se synchronisent par Valkey ; Caddy trouve chacune par le DNS (`endpoint_mode: dnsrr`) et répartit les WebSockets entre elles. Évitez ici `docker service scale` : le déploiement suivant remettrait le nombre d'origine.
- **api** et **worker** : une instance chacun. Faire tourner plusieurs API reste à venir.
- **drawio** et **gotenberg** tournent sur n'importe quel nœud ; une instance de chacun suffit.

## Sauvegardes

La base et les fichiers, tous deux sur le nœud des données. Là :

```bash
docker exec $(docker ps -q -f name=andal_postgres.) pg_dump -U andal -Fc andal > andal-$(date +%F).dump
```

```bash
docker run --rm -v andal_files:/data:ro -v "$PWD":/backup alpine tar czf /backup/andal-fichiers-$(date +%F).tgz -C /data .
```

Pour restaurer la base, arrêtez d'abord les services qui y écrivent (sur un manager) :

```bash
docker service scale andal_api=0 andal_collab=0 andal_worker=0
```

Puis sur le nœud des données :

```bash
docker exec -i $(docker ps -q -f name=andal_postgres.) pg_restore -U andal -d andal --clean --if-exists < andal-AAAA-MM-JJ.dump
```

Déployez de nouveau pour relancer les services.

## Mettre à jour

Sauvegardez, mettez la nouvelle version dans `ANDAL_VERSION` de `deploy/.env` (voir [CHANGELOG.fr.md](../../CHANGELOG.fr.md)), puis sur un manager :

```bash
set -a; . deploy/.env; set +a
```

D'abord la migration seule, avec la nouvelle version. La commande rend la main une fois qu'elle a fini :

```bash
docker service update --image "${ANDAL_IMAGE:-ghcr.io/open226bf/andal-server}:${ANDAL_VERSION}" --with-registry-auth andal_migrate
```

Puis tout le reste :

```bash
docker stack deploy -c deploy/swarm/stack.yaml --with-registry-auth --detach=false andal
```

L'API démarre sa nouvelle instance avant d'arrêter l'ancienne, et revient en arrière si la nouvelle ne devient jamais saine. La tâche de migration repasse et ne trouve plus rien à faire.

## Variantes

- **S3 externe** (MinIO, Garage, Scaleway, R2…) : renseignez `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` et les clés, puis retirez le service `rustfs` de `stack.yaml`. Les fichiers ne dépendent alors plus du nœud des données.
- **Réseau overlay chiffré** : si les nœuds communiquent par un réseau auquel vous ne vous fiez pas, ajoutez `driver_opts: { encrypted: "true" }` au réseau `backend`. Swarm chiffre alors le trafic entre nœuds par IPsec ; le protocole ESP (protocole IP 50) doit passer entre eux.
- **Derrière un proxy existant** (Traefik sur le cluster, par exemple) : retirez les `ports` et le placement de `web`, rattachez-le au réseau du proxy et routez le domaine vers son port 80. Caddy sert alors du HTTP simple : mettez `ANDAL_DOMAIN: ":80"` dans l'`environment` de `web` seulement, et gardez le domaine public dans `deploy/.env` (l'API en tire son adresse). Une limite pour l'instant : Caddy ne se fie pas à l'en-tête `X-Forwarded-For` posé par ce proxy, si bien que toutes les requêtes semblent venir du proxy et partagent la même limite de débit par adresse, connexion comprise. Placez Caddy en entrée chaque fois que c'est possible.
- **Imports** : le worker décompresse les archives sur le disque de son nœud. Prévoyez-y cinq fois `IMPORT_MAX_MB` d'espace libre.
- Tout le reste (SSO, SCIM, assistant, webhooks, synchro Git, export PDF, liens publics) se règle comme dans [le guide principal](../README.fr.md#variantes).

## Retirer

```bash
docker stack rm andal
```

Les volumes restent sur leurs nœuds (`andal_postgres`, `andal_valkey`, `andal_files`, `andal_caddy`) : un nouveau déploiement retrouve les mêmes données.
