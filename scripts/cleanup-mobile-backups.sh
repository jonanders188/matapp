#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

rm -f app/mobile/page.tsx.rej
rm -f app/mobile/page.tsx.orig
rm -f app/mobile/page.tsx.broken-now
rm -f app/mobile/page.tsx.broken-shelf-attempt
rm -f app/mobile/page.tsx.backup-before-shelf-v2
rm -f app/mobile/page.tsx.backup-before-shelf-manual

echo "Backup-/reject-filer ryddet."
git status --short
