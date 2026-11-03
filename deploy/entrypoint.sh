#!/bin/sh
# Point d'entrée de l'image serveur: un service par commande.
set -e
cmd="${1:-api}"
[ $# -gt 0 ] && shift
case "$cmd" in
  api) exec node apps/api/dist/main.js "$@" ;;
  collab) exec node apps/collab/dist/main.js "$@" ;;
  worker) exec node apps/worker/dist/main.js "$@" ;;
  migrate) exec node packages/db/dist/scripts/migrate.js "$@" ;;
  # Comptes en ligne de commande: `user add` (le premier devient propriétaire), `user password <email>`.
  user) exec node packages/db/dist/scripts/user.js "$@" ;;
  *) exec "$cmd" "$@" ;;
esac
