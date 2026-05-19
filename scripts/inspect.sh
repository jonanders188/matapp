#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "== Git =="
git branch --show-current
git remote -v
git status --short

echo
echo "== Node/npm =="
node -v
npm -v

echo
echo "== Package scripts =="
node -e "const p=require('./package.json'); console.log(p.scripts || {})"

echo
echo "== Viktige filer =="
for f in \
  app/mobile/page.tsx \
  lib/shelf-price-parser.ts \
  lib/kassalapp.ts \
  app/api/admin/stores/route.ts \
  app/api/mobile/stores/route.ts \
  app/api/mobile/shelf-price/route.ts \
  app/api/dashboard/basis-prices/route.ts \
  app/products/page.tsx
do
  if [ -f "$f" ]; then
    echo "OK  $f"
  else
    echo "MISSING  $f"
  fi
done

echo
echo "== Hyllekant parser =="
grep -n "shelf-price-parser\|extractShelfPriceCandidates\|mergeShelfCandidates" app/mobile/page.tsx lib/shelf-price-parser.ts 2>/dev/null || true

echo
echo "== Farlige tracked filer =="
git ls-files | grep -E '^node_modules/|^\.next/|^\.vercel/|^\.env$|^\.env\.|^\.DS_Store' || true
