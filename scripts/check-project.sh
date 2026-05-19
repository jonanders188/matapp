#!/usr/bin/env bash
set -euo pipefail

echo "== Git status =="
git status --short

echo
echo "== Sjekker at tunge/private filer ikke er tracked =="
BAD_FILES="$(git ls-files | grep -E '^node_modules/|^\.next/|^\.vercel/|^\.env|^\.DS_Store' || true)"
if [ -n "$BAD_FILES" ]; then
  echo "$BAD_FILES"
  echo "FEIL: Git tracker filer som ikke skal med."
  exit 1
fi

echo "OK: ingen tunge/private filer tracked."

echo
echo "== Build =="
npm run build
