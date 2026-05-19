#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "== Rydder backup/reject-filer =="

find app lib scripts -type f \( \
  -name "*.rej" \
  -o -name "*.orig" \
  -o -name "*.backup" \
  -o -name "*.bak" \
  -o -name "*.broken" \
  -o -name "*.broken-*" \
  -o -name "*.backup-*" \
\) -print -delete 2>/dev/null || true

rm -f app/mobile/page.tsx.broken-now
rm -f app/mobile/page.tsx.broken-shelf-attempt
rm -f app/mobile/page.tsx.backup-before-shelf-v2
rm -f app/mobile/page.tsx.backup-before-shelf-manual
rm -f app/mobile/page.tsx.backup-before-clean-shelf-refactor
rm -f app/mobile/page.tsx.backup-before-shelf-parser-refactor

echo
echo "== Git status =="
git status --short
