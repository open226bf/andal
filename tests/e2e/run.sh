#!/usr/bin/env bash
# Suites de bout en bout contre une stack qui tourne (pnpm infra:up, pnpm dev).
# Chaque suite repart des données de démo: la base est rechargée avant chacune.
#   tests/e2e/run.sh                  toutes les suites
#   tests/e2e/run.sh pages_test       une seule
set -u
cd "$(dirname "$0")/../.."

suites=(accounts_test access_notify_test pages_test versions_test projects_test files_links_test)
[ $# -gt 0 ] && suites=("$@")
failed=()

for suite in "${suites[@]}"; do
  pnpm --silent db:seed > /dev/null || { echo "Données de démo impossibles à charger"; exit 1; }
  echo "=== $suite"
  python3 "tests/e2e/$suite.py" || failed+=("$suite")
done

if [ $# -eq 0 ]; then
  for check in check:live-access check:readonly; do
    pnpm --silent db:seed > /dev/null
    echo "=== collab $check"
    pnpm --silent --filter @andal/collab "$check" || failed+=("$check")
  done
fi

pnpm --silent db:seed > /dev/null
if [ ${#failed[@]} -gt 0 ]; then
  echo "En échec: ${failed[*]}"
  exit 1
fi
echo "Toutes les suites passent."
