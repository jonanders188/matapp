#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

MOBILE="app/mobile/page.tsx"
PARSER="lib/shelf-price-parser.ts"

echo "== Backup =="
cp "$MOBILE" "$MOBILE.backup-before-clean-shelf-refactor"

echo "== Refaktor hyllekant-parser =="
python3 - <<'PY'
from pathlib import Path

mobile = Path("app/mobile/page.tsx")
parser = Path("lib/shelf-price-parser.ts")
parser.parent.mkdir(parents=True, exist_ok=True)

s = mobile.read_text()

def find_type_block(src: str, name: str):
    start = src.find(f"type {name} =")
    if start == -1:
        return None

    brace = src.find("{", start)
    if brace == -1:
        raise SystemExit(f"Fant type {name}, men ikke start-brace.")

    depth = 0
    end = None
    for i in range(brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                semi = src.find(";", i)
                if semi == -1:
                    raise SystemExit(f"Fant ikke semikolon etter type {name}.")
                end = semi + 1
                break

    if end is None:
        raise SystemExit(f"Fant ikke slutt på type {name}.")

    return start, end, src[start:end]

def find_function_block(src: str, name: str):
    start = src.find(f"function {name}(")
    if start == -1:
        return None

    brace = src.find("{", start)
    if brace == -1:
        raise SystemExit(f"Fant function {name}, men ikke start-brace.")

    depth = 0
    end = None
    for i in range(brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    if end is None:
        raise SystemExit(f"Fant ikke slutt på function {name}.")

    return start, end, src[start:end]

type_names = ["ShelfPriceCandidate", "OcrWord"]
function_names = [
    "normalizePriceCandidate",
    "extractShelfPriceCandidates",
    "extractShelfPriceCandidatesFromWords",
    "mergeShelfCandidates",
]

blocks = []

for name in type_names:
    found = find_type_block(s, name)
    if found is not None:
        blocks.append((found[0], found[1], name, found[2], "type"))

for name in function_names:
    found = find_function_block(s, name)
    if found is not None:
        blocks.append((found[0], found[1], name, found[2], "function"))

missing = [name for name in ["ShelfPriceCandidate", "extractShelfPriceCandidates", "extractShelfPriceCandidatesFromWords", "mergeShelfCandidates"] if name not in [b[2] for b in blocks]]
if missing:
    raise SystemExit(f"Mangler nødvendige blokker i mobile page: {missing}")

# Lag parserfil fra faktisk kode i mobile page.
block_by_name = {name: text for _, _, name, text, _ in blocks}

shelf_type = block_by_name["ShelfPriceCandidate"].replace("type ShelfPriceCandidate", "export type ShelfPriceCandidate", 1)
ocr_type = block_by_name.get("OcrWord", "")
normalizer = block_by_name.get("normalizePriceCandidate", "")
text_parser = block_by_name["extractShelfPriceCandidates"].replace("function extractShelfPriceCandidates", "export function extractShelfPriceCandidates", 1)
word_parser = block_by_name["extractShelfPriceCandidatesFromWords"].replace("function extractShelfPriceCandidatesFromWords", "export function extractShelfPriceCandidatesFromWords", 1)
merge = block_by_name["mergeShelfCandidates"].replace("function mergeShelfCandidates", "export function mergeShelfCandidates", 1)

parser.write_text(
    "\n\n".join([
        shelf_type,
        ocr_type,
        normalizer,
        text_parser,
        word_parser,
        merge,
    ]).strip() + "\n"
)

# Fjern blokkene fra mobile page bakfra slik at posisjoner ikke flytter seg.
for start, end, name, text, kind in sorted(blocks, key=lambda item: item[0], reverse=True):
    s = s[:start] + s[end:]

# Legg inn import.
import_line = 'import { authFetch } from "@/lib/auth-fetch";'
new_import = '''import { authFetch } from "@/lib/auth-fetch";
import {
  extractShelfPriceCandidates,
  extractShelfPriceCandidatesFromWords,
  mergeShelfCandidates,
  type ShelfPriceCandidate
} from "@/lib/shelf-price-parser";'''

if new_import not in s:
    if import_line not in s:
        raise SystemExit("Fant ikke authFetch-import.")
    s = s.replace(import_line, new_import, 1)

# Legg inn auto-prefill fra eksisterende butikkpris.
if "Fant eksisterende butikkpris" not in s:
    anchor = "  async function loadStores() {"
    if anchor not in s:
        raise SystemExit("Fant ikke anker for loadStores.")

    prefill = r'''
  useEffect(() => {
    if (!lookup || !selectedStoreKey) return;

    const normalizeStore = (value: unknown) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");

    const wantedStoreKey = normalizeStore(selectedStoreKey);
    const prices = Array.isArray(lookup.prices) ? lookup.prices : [];

    const matchingPrices = prices
      .map((price) => {
        const item = price as {
          storeKey?: string;
          storeCode?: string;
          storeName?: string;
          price?: number | string | null;
          observedAt?: string | null;
          isFresh?: boolean;
          source?: string | null;
        };

        const numericPrice =
          typeof item.price === "number"
            ? item.price
            : typeof item.price === "string"
              ? Number(item.price.replace(",", "."))
              : NaN;

        return {
          ...item,
          numericPrice,
          normalizedStoreKey: normalizeStore(item.storeKey ?? item.storeCode ?? item.storeName)
        };
      })
      .filter((price) => (
        price.normalizedStoreKey === wantedStoreKey &&
        Number.isFinite(price.numericPrice) &&
        price.numericPrice > 0
      ))
      .sort((a, b) => {
        const freshScore = Number(Boolean(b.isFresh)) - Number(Boolean(a.isFresh));
        if (freshScore !== 0) return freshScore;

        const aTime = a.observedAt ? Date.parse(a.observedAt) : 0;
        const bTime = b.observedAt ? Date.parse(b.observedAt) : 0;
        return bTime - aTime;
      });

    const bestPrice = matchingPrices[0];
    if (!bestPrice) return;

    setManualPrice(bestPrice.numericPrice.toFixed(2).replace(".", ","));

    const storeName = bestPrice.storeName ?? selectedStore?.storeName ?? selectedStoreKey;
    setShelfOcrStatus(
      `Fant eksisterende butikkpris hos ${storeName}: ${kr(bestPrice.numericPrice)}. Kontroller og trykk Lagre.`
    );
  }, [lookup, selectedStoreKey, selectedStore?.storeName]);

'''
    s = s.replace(anchor, prefill + "\n" + anchor, 1)

# Rydd blanklinjer.
while "\n\n\n\n" in s:
    s = s.replace("\n\n\n\n", "\n\n\n")

mobile.write_text(s)

print("OK: parser flyttet til lib/shelf-price-parser.ts")
print("OK: mobile page importerer parser")
print("OK: eksisterende butikkpris fyller manuelt prisfelt")
PY

echo
echo "== Verifisering =="
grep -n "shelf-price-parser" "$MOBILE"

if grep -n "^type ShelfPriceCandidate\|^type OcrWord\|^function normalizePriceCandidate\|^function extractShelfPriceCandidates\|^function extractShelfPriceCandidatesFromWords\|^function mergeShelfCandidates" "$MOBILE"; then
  echo "FEIL: parserdefinisjoner ligger fortsatt i app/mobile/page.tsx"
  exit 1
fi

grep -n "export type ShelfPriceCandidate\|export function extractShelfPriceCandidates\|export function extractShelfPriceCandidatesFromWords\|export function mergeShelfCandidates" "$PARSER"

echo
echo "== Build =="
npm run build

echo
echo "OK: refaktor og build fullført."
