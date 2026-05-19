#!/usr/bin/env bash
set -euo pipefail

MESSAGE="${1:-}"

if [ -z "$MESSAGE" ]; then
  echo "Bruk:"
  echo "./scripts/push.sh \"Commit message\""
  exit 1
fi

echo "== Kjører check først =="
./scripts/check.sh

echo
echo "== Git status før commit =="
git status --short

if [ -z "$(git status --short)" ]; then
  echo "Ingen endringer å committe."
  exit 0
fi

echo
echo "== Legger til endringer =="
git add .

echo
echo "== Git status staged =="
git status --short

echo
echo "== Commit =="
git commit -m "$MESSAGE"

echo
echo "== Push =="
git push

echo
echo "OK: commit og push ferdig."
