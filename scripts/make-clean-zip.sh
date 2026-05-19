#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"
PARENT_DIR="$(dirname "$PROJECT_ROOT")"
ZIP_PATH="$PARENT_DIR/husholdningspilot-current.zip"

echo "== Lager ren ZIP =="
echo "Prosjekt: $PROJECT_ROOT"
echo "ZIP: $ZIP_PATH"

cd "$PARENT_DIR"

rm -f "$ZIP_PATH"

zip -r "$ZIP_PATH" "$PROJECT_NAME" \
  -x "*/node_modules/*" \
  -x "*/.next/*" \
  -x "*/.vercel/*" \
  -x "*/.git/*" \
  -x "*/.env" \
  -x "*/.env.*" \
  -x "*/.DS_Store" \
  -x "*/coverage/*" \
  -x "*/dist/*" \
  -x "*/build/*" \
  -x "*/.turbo/*" \
  -x "*/.cache/*" \
  -x "*/npm-debug.log*" \
  -x "*/yarn-debug.log*" \
  -x "*/yarn-error.log*" \
  -x "*/pnpm-debug.log*" \
  >/dev/null

echo
echo "== Sjekker at ZIP er ren =="
BAD_ZIP_CONTENT="$(unzip -l "$ZIP_PATH" | grep -E 'node_modules/|\.next/|\.vercel/|\.git/|/\.env$|/\.env\.|/\.DS_Store|coverage/|dist/|build/|\.turbo/|\.cache/' || true)"

if [ -n "$BAD_ZIP_CONTENT" ]; then
  echo "$BAD_ZIP_CONTENT"
  echo
  echo "FEIL: ZIP inneholder filer som burde vært ekskludert."
  exit 1
fi

echo "OK: ZIP er ren."
echo
ls -lh "$ZIP_PATH"
