#!/usr/bin/env bash
set -euo pipefail

echo "== Prosjekt =="
pwd

echo
echo "== Git status =="
git status --short

echo
echo "== Sjekker at tunge/private filer ikke er tracked =="
BAD_FILES="$(git ls-files | grep -E '^node_modules/|^\.next/|^\.vercel/|^\.env$|^\.env\.|^\.DS_Store' || true)"

if [ -n "$BAD_FILES" ]; then
  echo "$BAD_FILES"
  echo
  echo "FEIL: Git tracker filer som ikke skal med."
  echo "Rydd før commit."
  exit 1
fi

echo "OK: ingen tunge/private filer tracked."

echo
echo "== npm run build =="
npm run build

echo
echo "OK: check ferdig."
