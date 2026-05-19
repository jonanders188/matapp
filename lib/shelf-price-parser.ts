export type ShelfPriceCandidate = {
  price: number;
  label: string;
  context: string;
  score: number;
  reason?: string;
  kind?: "main" | "unit";
};

type OcrWord = {
  text?: string;
  confidence?: number;
  bbox?: {
    x0?: number;
    y0?: number;
    x1?: number;
    y1?: number;
  };
};

function normalizePriceCandidate(kroner: string, ore: string) {
  const price = Number(`${kroner.replace(/\D/g, "")}.${ore.replace(/\D/g, "")}`);
  return Number.isFinite(price) && price > 0 && price < 1000 ? price : null;
}

function contextAroundMatch(text: string, index: number, length: number, radius = 22) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function sortShelfCandidates(a: ShelfPriceCandidate, b: ShelfPriceCandidate) {
  if (a.kind !== b.kind) return a.kind === "main" ? -1 : 1;
  return b.score - a.score || a.price - b.price;
}

export function extractShelfPriceCandidates(text: string): ShelfPriceCandidate[] {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1");

  const candidates = new Map<string, ShelfPriceCandidate>();

  const addCandidate = (
    price: number,
    label: string,
    context: string,
    score: number,
    reason: string,
    kind: "main" | "unit" = "main"
  ) => {
    if (!Number.isFinite(price) || price <= 0 || price > 9999) return;

    const key = `${kind}:${price.toFixed(2)}`;
    const candidate: ShelfPriceCandidate = { price, label, context, score, reason, kind };
    const existing = candidates.get(key);
    if (!existing || candidate.score > existing.score) candidates.set(key, candidate);
  };

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const unitWords = /(pr\s*kg|\/\s*kg|kr\s*\/\s*kg|kgpris|kilopris|pr\s*l|\/\s*l|kr\s*\/\s*l|literpris|enhetspris)/i;
  const pieceWords = /(\/\s*stk|pr\s*stk|stkpris|stykkpris)/i;

  for (const line of lines) {
    const context = line.replace(/\s+/g, " ").trim();

    // 25 90, 47 90, 21 30. This is often main shelf price.
    for (const match of context.matchAll(/(?:^|\D)(\d{1,3})\s+(\d{2})(?:\D|$)/g)) {
      const kroner = match[1];
      const ore = match[2];
      const price = normalizePriceCandidate(kroner, ore);
      if (price === null) continue;

      const localContext = contextAroundMatch(context, match.index ?? 0, match[0].length);
      const hasUnit = unitWords.test(localContext);
      const hasPiece = pieceWords.test(localContext);

      let score = 90;
      if (hasPiece) score += 30;
      if (hasUnit) score -= 90;
      if ([90, 95, 99, 50, 30].includes(Number(ore))) score += 6;
      if (price > 250) score -= 30;

      addCandidate(
        price,
        `${kroner},${ore}`,
        localContext || context,
        score,
        hasUnit ? "Enhetspris-tekst i nærheten" : hasPiece ? "Stykkpris/hovedpris" : "Teksttreff",
        hasUnit ? "unit" : "main"
      );
    }

    // 25,90 / 25.90 style.
    for (const match of context.matchAll(/(?:^|\D)(\d{1,3})[,.](\d{2})(?:\D|$)/g)) {
      const kroner = match[1];
      const ore = match[2];
      const price = normalizePriceCandidate(kroner, ore);
      if (price === null) continue;

      const localContext = contextAroundMatch(context, match.index ?? 0, match[0].length);
      const hasUnit = unitWords.test(localContext);
      const hasPiece = pieceWords.test(localContext);

      let score = 75;
      if (hasPiece) score += 30;
      if (hasUnit) score -= 95;
      if (price > 250) score -= 20;

      addCandidate(
        price,
        `${kroner},${ore}`,
        localContext || context,
        score,
        hasUnit ? "Enhetspris" : hasPiece ? "Stykkpris/hovedpris" : "Tekstpris",
        hasUnit ? "unit" : "main"
      );
    }
  }

  return [...candidates.values()].sort(sortShelfCandidates).slice(0, 8);
}

export function extractShelfPriceCandidatesFromWords(wordsInput: unknown): ShelfPriceCandidate[] {
  if (!Array.isArray(wordsInput)) return [];

  type WordBox = {
    text: string;
    raw: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    width: number;
    height: number;
    cx: number;
    cy: number;
  };

  const words = (wordsInput as Array<{ text?: string; bbox?: { x0?: number; y0?: number; x1?: number; y1?: number } }>)
    .map((word): WordBox => {
      const raw = String(word.text ?? "").trim();
      const text = raw.replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/,/g, ".").trim();
      const bbox = word.bbox ?? {};
      const x0 = Number(bbox.x0 ?? 0);
      const y0 = Number(bbox.y0 ?? 0);
      const x1 = Number(bbox.x1 ?? 0);
      const y1 = Number(bbox.y1 ?? 0);
      const width = Math.max(1, x1 - x0);
      const height = Math.max(1, y1 - y0);
      return { raw, text, x0, y0, x1, y1, width, height, cx: x0 + width / 2, cy: y0 + height / 2 };
    })
    .filter((word) => word.text.length > 0);

  const numericWords = words.filter((word) => /\d/.test(word.text));
  if (!numericWords.length) return [];

  const maxX = Math.max(...words.map((word) => word.x1), 1);
  const maxY = Math.max(...words.map((word) => word.y1), 1);
  const heights = numericWords.map((word) => word.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 1;

  const candidates = new Map<string, ShelfPriceCandidate>();

  const nearbyText = (target: WordBox, radiusX = 150, radiusY = 55) => {
    return words
      .filter((word) => Math.abs(word.cx - target.cx) <= radiusX && Math.abs(word.cy - target.cy) <= radiusY)
      .map((word) => word.raw)
      .join(" ");
  };

  const addCandidate = (candidate: ShelfPriceCandidate) => {
    if (!Number.isFinite(candidate.price) || candidate.price <= 0 || candidate.price > 9999) return;
    const key = `${candidate.kind}:${candidate.price.toFixed(2)}`;
    const existing = candidates.get(key);
    if (!existing || candidate.score > existing.score) candidates.set(key, candidate);
  };

  const unitWords = /(pr\s*kg|\/\s*kg|kr\s*\/\s*kg|kgpris|kilopris|pr\s*l|\/\s*l|kr\s*\/\s*l|literpris|enhetspris)/i;
  const pieceWords = /(\/\s*stk|pr\s*stk|stkpris|stykkpris)/i;

  // Main shelf price pattern: large kroner word plus small two-digit ore word close to the upper/right side.
  for (const kronerWord of numericWords) {
    if (!/^\d{1,3}$/.test(kronerWord.text)) continue;

    const kroner = kronerWord.text;
    const largeMainNumber = kronerWord.height >= medianHeight * 1.15;
    const rightSide = kronerWord.cx > maxX * 0.45;
    const lowerArea = kronerWord.cy > maxY * 0.62;

    for (const oreWord of numericWords) {
      if (oreWord === kronerWord) continue;
      if (!/^\d{2}$/.test(oreWord.text)) continue;

      const rightOfKroner = oreWord.x0 >= kronerWord.x0 + kronerWord.width * 0.25;
      const closeX = oreWord.x0 - kronerWord.x1 < kronerWord.width * 1.8;
      const closeY = Math.abs(oreWord.cy - kronerWord.cy) < kronerWord.height * 0.85;
      const smallerOre = oreWord.height <= kronerWord.height * 1.05;

      if (!rightOfKroner || !closeX || !closeY || !smallerOre) continue;

      const price = normalizePriceCandidate(kroner, oreWord.text);
      if (price === null) continue;

      const context = `${nearbyText(kronerWord)} ${nearbyText(oreWord)}`.replace(/\s+/g, " ").trim();
      const hasUnit = unitWords.test(context);
      const hasPiece = pieceWords.test(context);

      let score = 125;
      if (largeMainNumber) score += 45;
      if (rightSide) score += 25;
      if (hasPiece) score += 20;
      if (hasUnit) score -= 110;
      if (lowerArea && hasUnit) score -= 35;
      if (price > 250) score -= 45;

      addCandidate({
        price,
        label: `${kroner},${oreWord.text}`,
        context: context || `Prisfont ${kroner} + ${oreWord.text}`,
        score,
        reason: hasUnit ? "Ser ut som enhetspris" : largeMainNumber ? "Stor hovedpris" : "Ordposisjon",
        kind: hasUnit ? "unit" : "main"
      });
    }
  }

  // Unit price pattern: 259.00 Pr KG, 479,00 /KG, 53.25.
  for (const word of numericWords) {
    const match = word.text.match(/^(\d{1,4})[.](\d{2})$/);
    if (!match) continue;

    const price = normalizePriceCandidate(match[1], match[2]);
    if (price === null) continue;

    const context = nearbyText(word, 180, 65);
    const hasUnit = unitWords.test(context);
    const hasPiece = pieceWords.test(context);
    const leftSide = word.cx < maxX * 0.45;
    const lowerArea = word.cy > maxY * 0.55;

    let score = 60;
    if (hasUnit) score += 80;
    if (leftSide && lowerArea) score += 25;
    if (hasPiece) score -= 50;

    addCandidate({
      price,
      label: `${match[1]},${match[2]}`,
      context,
      score,
      reason: hasUnit ? "Enhetspris/kgpris" : "Desimalpris",
      kind: hasUnit || (leftSide && lowerArea && price > 40) ? "unit" : "main"
    } as ShelfPriceCandidate);
  }

  return [...candidates.values()].sort(sortShelfCandidates).slice(0, 8);
}

export function mergeShelfCandidates(...candidateGroups: ShelfPriceCandidate[][]) {
  const merged = new Map<string, ShelfPriceCandidate>();
  for (const candidate of candidateGroups.flat()) {
    const key = candidate.price.toFixed(2);
    const existing = merged.get(key);
    if (!existing || candidate.score > existing.score) merged.set(key, candidate);
  }
  return [...merged.values()].sort(sortShelfCandidates).slice(0, 6);
}
