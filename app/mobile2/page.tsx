"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

type ScanMode = "in" | "out";
type MobileMode = ScanMode | "receipt";

type BarcodeResult = {
  rawValue: string;
};

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement | HTMLImageElement | ImageBitmap): Promise<BarcodeResult[]>;
};

type ReceiptLine = {
  id: string;
  text: string;
  price: number;
  quantity: number;
  quantityUnit: "stk" | "kg" | "l";
  quantitySourceText?: string | null;
  unitPrice: number;
  totalPrice: number;
  lineTotalSourceText?: string | null;
  usedAt?: string;
  matchedProductName?: string;
};

type ReceiptAiItem = {
  name: string;
  quantity: number;
  unit: "stk";
  quantitySourceText?: string | null;
  lineTotal: number;
  lineTotalSourceText?: string | null;
  unitPrice: number;
  confidence: number;
  warning?: string | null;
};

type ReceiptAiResponse = {
  data?: {
    storeKey: string | null;
    storeName: string | null;
    receiptDate: string | null;
    items: ReceiptAiItem[];
    warnings: string[];
  };
  error?: string;
};

type ReceiptCache = {
  storeKey?: string;
  storeName: string;
  createdAt: string;
  expiresAt: string;
  lines: ReceiptLine[];
};

type StoreOption = {
  storeKey: string;
  storeName: string;
  isEnabled: boolean;
  priority: number;
};

type ShelfCapture = {
  ean: string;
  price: number | null;
  text: string;
};

type ScanResponse = {
  data?: {
    ean: string;
    mode: ScanMode;
    product: {
      id?: string;
      name: string;
      brand?: string | null;
      image_url?: string | null;
      package_size?: string | null;
    };
    beforeQuantity: number;
    afterQuantity: number;
    createdProduct: boolean;
    priceObservationsInserted: number;
    receiptPriceMatch?: {
      lineId: string;
      lineText: string;
      price: number;
      quantity: number;
      quantityUnit?: "stk" | "kg" | "l";
      unitPrice: number;
      totalPrice: number;
      storeName: string;
      inserted: boolean;
      warning?: string | null;
    } | null;
  };
  error?: string;
  message?: string;
};

type ReceiptFrameAnalysis = {
  isReceipt: boolean;
  score: number;
  brightRatio: number;
  textRows: number;
};

type TesseractProgress = {
  status?: string;
  progress?: number;
};

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const RECEIPT_CACHE_KEY = "husholdningspilot.receipt-cache.v1";
const RECEIPT_TTL_MS = 60 * 60 * 1000;

function cleanEan(value: string) {
  return value.replace(/\D/g, "").trim();
}

function modeText(mode: ScanMode) {
  return mode === "in" ? "Inn på lager" : "Ut av lager";
}

function mobileModeText(mode: MobileMode) {
  if (mode === "receipt") return "Kvittering";
  return modeText(mode);
}

function beep(success = true) {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = success ? 880 : 220;
  gain.gain.value = 0.08;

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + (success ? 0.08 : 0.18));

  window.setTimeout(() => ctx.close().catch(() => undefined), 300);
}

function normalizeReceiptOcrLine(value: string) {
  return value
    .replace(/[|]/g, " ")
    .replace(/[—–]/g, "-")
    .replace(/(?<=\d)[oO](?=\d|\s|$)/g, "0")
    .replace(/(?<=\d)[lI](?=\d|\s|$)/g, "1")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/[oO]/g, "0")
    .replace(/,/g, ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function formatReceiptPrice(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function formatReceiptQuantity(quantity: number, unit: "stk" | "kg" | "l") {
  const formatted = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  return `${formatted} ${unit}`;
}

const RECEIPT_STK_QUANTITY_MARKER = "__RECEIPT_QTY_STK_";

function receiptQuantityMarker(quantity: number) {
  return `${RECEIPT_STK_QUANTITY_MARKER}${quantity}__`;
}

function normalizeReceiptQuantityText(value: string) {
  return normalizeReceiptOcrLine(value)
    .replace(/,/g, ".")
    .replace(/\bst\s*k\b/gi, "stk")
    .replace(/\bst\.?\b/gi, "stk")
    .replace(/\s+/g, " ")
    .trim();
}

function validReceiptStkQuantity(value: number) {
  return Number.isFinite(value) && value > 0 && value < 100 ? Math.floor(value) : 1;
}


type ReceiptStkQuantity = { quantity: number; unit: "stk" };

function normalizeStkQuantityText(value: string) {
  return normalizeReceiptOcrLine(value)
    .toLowerCase()
    .replace(/[,]/g, ".")
    .replace(/\bst\s*k\b/g, "stk")
    .replace(/\bs\s*t\s*k\b/g, "stk")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBoughtQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99) return 1;
  return Math.max(1, Math.floor(quantity));
}

function parseBoughtStkQuantityPrefix(value: string): ReceiptStkQuantity | null {
  const normalized = normalizeStkQuantityText(value);

  // Kjøpt antall må stå helt først. Dette hindrer at pakkestørrelser i varenavn
  // tolkes som antall, f.eks. "Båtis multipack 5stk" eller "Libero 18stk".
  const match =
    normalized.match(/^(?:antall\s*)?(\d{1,3})(?:\.\d+)?\s*(?:stk|x|\*)\b/i) ??
    normalized.match(/^(?:antall\s*)?(\d{1,3})(?:\.\d+)?\s+for\b/i);

  if (!match) return null;
  return { quantity: normalizeBoughtQuantity(Number(match[1])), unit: "stk" };
}


function parseReceiptQuantity(value: string): ReceiptStkQuantity {
  return parseBoughtStkQuantityPrefix(value) ?? { quantity: 1, unit: "stk" };
}

function receiptLineLooksLikeQuantityOnly(line: string) {
  const normalized = normalizeStkQuantityText(line);
  if (!normalized) return false;
  if (/(trumf|bonus|mva|tilbud|rabatt|fast|knallkjøp|knallkjop|sum|total)/i.test(normalized)) return false;

  // Kiwi/Meny legger ofte antall på linjen etter varen: "1stk" eller "1 stk".
  // Vi aksepterer bare rene antallslinjer, ikke produktnavn med pakkestørrelse.
  return /^(?:antall\s*)?\d{1,3}(?:\.\d+)?\s*(?:stk|x|\*)\.?$/i.test(normalized) ||
    /^(?:antall\s*)?\d{1,3}(?:\.\d+)?\s+for\.?$/i.test(normalized);
}

function normalizeStoreText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replaceAll("æ", "a")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function storeTextKey(value: string) {
  return normalizeStoreText(value).replace(/\s+/g, "_");
}

function canonicalStoreName(value: string) {
  const normalized = normalizeStoreText(value);
  if (/\bkiwi\b/.test(normalized)) return "KIWI";
  if (/\bmeny\b/.test(normalized)) return "MENY";
  if (/\brema\b|\brema\s*1000\b/.test(normalized)) return "REMA 1000";
  if (/\bcoop\b|\bextra\b/.test(normalized)) return normalized.includes("mega") ? "Coop Mega" : normalized.includes("obs") ? "Coop Obs" : "Extra";
  if (/\bspar\b/.test(normalized)) return "SPAR";
  if (/\bjoker\b/.test(normalized)) return "Joker";
  if (/\bbunnpris\b/.test(normalized)) return "Bunnpris";
  return value.trim();
}

function detectStoreCandidatesFromText(text: string, stores: StoreOption[]) {
  const normalized = normalizeStoreText(text);
  const direct = new Map<string, StoreOption>();

  for (const store of stores) {
    const name = normalizeStoreText(store.storeName);
    const key = normalizeStoreText(store.storeKey.replace(/_/g, " "));
    if ((name && normalized.includes(name)) || (key && normalized.includes(key))) {
      direct.set(store.storeKey, store);
    }
  }

  const aliases = ["KIWI", "MENY", "REMA 1000", "Extra", "Coop Mega", "Coop Obs", "SPAR", "Joker", "Bunnpris"];
  for (const alias of aliases) {
    const aliasKey = normalizeStoreText(alias);
    if (!normalized.includes(aliasKey)) continue;
    const match = stores.find((store) => normalizeStoreText(store.storeName).includes(aliasKey) || aliasKey.includes(normalizeStoreText(store.storeName)));
    if (match) direct.set(match.storeKey, match);
  }

  return [...direct.values()].sort((a, b) => a.priority - b.priority || a.storeName.localeCompare(b.storeName, "nb"));
}

function parseShelfPrice(text: string) {
  const normalized = normalizeReceiptOcrLine(text);
  const candidates: number[] = [];

  for (const match of normalized.matchAll(/(?:kr\s*)?(\d{1,4}[,.]\d{2})(?!\s*(?:g|kg|ml|l)\b)/gi)) {
    const value = parsePrice(match[1]);
    if (value !== null && value > 0 && value <= 5000) candidates.push(value);
  }

  if (!candidates.length) return null;
  return candidates.sort((a, b) => a - b)[0];
}

function parseShelfEan(text: string) {
  const digits = text.replace(/\D/g, " ");
  for (const match of digits.matchAll(/\b\d{13}\b/g)) return match[0];
  for (const match of digits.matchAll(/\b\d{8}\b/g)) return match[0];
  return "";
}

function receiptLineLooksLikeNoise(line: string) {
  const normalized = line.toLowerCase();
  return /(sum|subtotal|total|mva|moms|visa|bankaxept|mastercard|kort|kontant|avrunding|trumf|bonus|medlems|pose|bong|kvittering|org\.?nr|butikk|terminal|aid|takk|betalt|vekslepenger|saldo|godkjent|ref\.?|dato|kl\.?|klokke|varekjop|varekjøp)/i.test(normalized);
}

function receiptLineLooksLikeDiscount(line: string) {
  return /(rabatt|kupong|tilbud|pantelapp|retur|kampanje|priskutt|medlemspris)/i.test(line) || /-\s*\d{1,4}[,.]\d{2}\s*[A-Z]?\s*$/.test(line);
}

function receiptLineLooksLikePaymentOrMeta(line: string) {
  const digits = line.replace(/\D/g, "");
  if (digits.length >= 12 && !/[a-zæøå]/i.test(line)) return true;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(line)) return true;
  if (/^\d{2}:\d{2}/.test(line)) return true;
  return false;
}

function extractReceiptPrices(line: string) {
  const prices: Array<{ raw: string; index: number; value: number }> = [];
  const pattern = /(?:^|\s)(-?\d{1,4}(?:[,.]\d{2}|[,.]-)|-?\d{1,4}\s[,.]\s\d{2})\s*[A-Z]?\s*(?=$|\s)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    const raw = match[1].replace(/[,.]-$/, ".00").replace(/\s+/g, "");
    const value = parsePrice(raw);
    if (value !== null && value > 0 && value <= 5000) {
      prices.push({ raw: match[1], index: match.index, value });
    }
  }

  return prices;
}

function cleanReceiptProductText(value: string) {
  return value
    .replace(new RegExp(`${RECEIPT_STK_QUANTITY_MARKER}\\d{1,3}__`, "gi"), "")
    .replace(/^\s*(?:antall\s*)?\d{1,3}(?:[,.]\d+)?\s*(?:stk|st\.?)\b\s*/gi, "")
    .replace(/^\s*(?:antall\s*)?\d{1,3}(?:[,.]\d+)?\s*(?:[xX*]|for)\b\s*/gi, "")
    .replace(/\b(?:a|b|mva|mvafri|kg|stk)\b\s*$/gi, "")
    .replace(/[=*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function receiptProductTextLooksLikeProduct(value: string) {
  const normalized = normalizeReceiptOcrLine(value).toLowerCase();
  if (!normalized) return false;

  // Footer/tax/bonus rows are often OCR-read as lines such as
  // "6,14kr 15%" or "229k 25% 077k 306k 843kr - 185k".
  // Those are not products, even if "kr" gives them letters.
  if (/%/.test(normalized)) return false;
  if (/\b(?:mva|bonus|bonusgrunnlag|grunnbonus|trumf|sum|total|kjopesum|kjøpesum|besparelser)\b/i.test(normalized)) return false;

  const meaningfulWords = normalized
    .replace(/\d+(?:[,.]\d+)?/g, " ")
    .replace(/\b(?:kr|k|ore|øre|stk|st|kg|g|l|ml|mva|mvafri|a|b)\b/g, " ")
    .replace(/[^a-zæøå]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 2);

  return meaningfulWords.length > 0;
}

function buildReceiptCandidateLines(text: string) {
  const sourceLines = text
    .split(/\r?\n/)
    .map(normalizeReceiptOcrLine)
    .filter(Boolean);

  const candidates: string[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    const next = sourceLines[index + 1];
    const prices = extractReceiptPrices(line);
    const hasLetters = /[a-zæøå]/i.test(line);

    // Kiwi/Meny ser ut til å bruke denne formen:
    //   Produktnavn                         27,80 kr
    //   2 stk
    // Da flytter vi "2 stk" foran linjen, slik at parseren kan regne 27,80 / 2.
    if (prices.length && hasLetters && next && receiptLineLooksLikeQuantityOnly(next)) {
      candidates.push(`${next} ${line}`);
      continue;
    }

    candidates.push(line);

    // OCR kan av og til dele produkt og pris over to linjer.
    if (!prices.length && hasLetters && next && extractReceiptPrices(next).length && !/[a-zæøå]{3,}/i.test(next)) {
      candidates.push(`${line} ${next}`);
    }
  }

  return candidates;
}

function parseReceiptText(text: string): ReceiptLine[] {
  const seen = new Set<string>();
  const result: ReceiptLine[] = [];

  for (const line of buildReceiptCandidateLines(text)) {
    if (line.length < 4) continue;
    if (receiptLineLooksLikeNoise(line) || receiptLineLooksLikeDiscount(line) || receiptLineLooksLikePaymentOrMeta(line)) continue;

    const prices = extractReceiptPrices(line);
    if (!prices.length) continue;

    const price = prices[prices.length - 1];
    const rawProductPart = line.slice(0, price.index);
    const parsedQuantity = parseReceiptQuantity(rawProductPart);
    const quantity = parsedQuantity.quantity;
    const quantityUnit = parsedQuantity.unit;
    const totalPrice = Number(price.value.toFixed(2));
    const unitPrice = Number((totalPrice / quantity).toFixed(2));
    const textPart = cleanReceiptProductText(rawProductPart);

    if (textPart.length < 3 || !/[a-zæøå]/i.test(textPart)) continue;
    if (/^\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk)?$/i.test(textPart)) continue;
    if (!receiptProductTextLooksLikeProduct(textPart)) continue;

    const dedupeKey = `${textPart.toLowerCase()}-${quantity}-${unitPrice.toFixed(2)}-${totalPrice.toFixed(2)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    result.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: textPart,
      price: unitPrice,
      quantity,
      quantityUnit,
      unitPrice,
      totalPrice
    });
  }

  return result;
}

function receiptLineFromAiItem(item: ReceiptAiItem, index: number): ReceiptLine | null {
  const name = String(item.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 3) return null;

  const rawQuantity = Number(item.quantity);
  const quantity = Number.isFinite(rawQuantity) ? Math.max(1, Math.min(99, Math.floor(rawQuantity))) : 1;
  const lineTotal = Number(Number(item.lineTotal).toFixed(2));
  const unitPrice = Number(Number(item.unitPrice || lineTotal / quantity).toFixed(2));

  if (!Number.isFinite(lineTotal) || lineTotal <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

  return {
    id: `ai-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    text: cleanReceiptProductText(name),
    price: unitPrice,
    quantity,
    quantityUnit: "stk",
    unitPrice,
    totalPrice: lineTotal
  };
}

function receiptAiLinesToText(lines: ReceiptLine[]) {
  return lines
    .map((line) => `${formatReceiptQuantity(line.quantity, "stk")} ${line.text} ${formatReceiptPrice(line.totalPrice)}`)
    .join("\n");
}

async function imageSourceToDataUrl(source: string | File) {
  if (typeof source === "string") return source;

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Kunne ikke lese bildefil."));
    reader.readAsDataURL(source);
  });
}

function readReceiptCache(): ReceiptCache | null {
  try {
    const raw = window.localStorage.getItem(RECEIPT_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as ReceiptCache;
    if (!parsed.expiresAt || Date.parse(parsed.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(RECEIPT_CACHE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeReceiptCache(cache: ReceiptCache | null) {
  if (!cache) {
    window.localStorage.removeItem(RECEIPT_CACHE_KEY);
    return;
  }

  window.localStorage.setItem(RECEIPT_CACHE_KEY, JSON.stringify(cache));
}

function analyzeReceiptFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ReceiptFrameAnalysis | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  const width = 96;
  const height = 128;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const left = Math.round(width * 0.18);
  const right = Math.round(width * 0.82);
  const top = Math.round(height * 0.05);
  const bottom = Math.round(height * 0.95);

  let bright = 0;
  let total = 0;
  let dark = 0;
  let edgeContrast = 0;
  const rowDarkCounts = new Array(height).fill(0) as number[];

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      total += 1;
      if (luma > 172) bright += 1;
      if (luma < 118) {
        dark += 1;
        rowDarkCounts[y] += 1;
      }
    }
  }

  for (let y = top; y < bottom; y += 4) {
    const leftIndex = (y * width + left) * 4;
    const rightIndex = (y * width + (right - 1)) * 4;
    const leftLuma = 0.2126 * data[leftIndex] + 0.7152 * data[leftIndex + 1] + 0.0722 * data[leftIndex + 2];
    const rightLuma = 0.2126 * data[rightIndex] + 0.7152 * data[rightIndex + 1] + 0.0722 * data[rightIndex + 2];
    edgeContrast += Math.abs(leftLuma - rightLuma);
  }

  const brightRatio = total ? bright / total : 0;
  const darkRatio = total ? dark / total : 0;
  const textRows = rowDarkCounts.filter((count) => count >= 3 && count <= 35).length;
  const textRowRatio = textRows / (bottom - top);
  const averageEdgeContrast = edgeContrast / Math.max(1, (bottom - top) / 4);

  const score = Math.round(
    Math.min(100, brightRatio * 55 + textRowRatio * 95 + Math.min(25, averageEdgeContrast / 7) + Math.min(15, darkRatio * 90))
  );

  return {
    isReceipt: brightRatio > 0.38 && textRows >= 12 && darkRatio > 0.015 && score >= 58,
    score,
    brightRatio,
    textRows
  };
}

function captureVideoFrame(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) return null;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function loadReceiptOcrImage(source: string | File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    let objectUrl: string | null = null;

    image.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error("Kunne ikke laste kvitteringsbildet for OCR."));
    };

    if (typeof source === "string") {
      image.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      image.src = objectUrl;
    }
  });
}

async function preprocessReceiptImageForOcr(source: string | File) {
  const image = await loadReceiptOcrImage(source);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) return source;

  // Trumf/Kiwi/Meny-kvitteringer har ofte små, tynne antallstall på egen linje
  // (f.eks. "4 stk"). Forstørr og terskle bildet før OCR slik at enslige
  // tall ikke forsvinner like lett.
  const longSide = Math.max(width, height);
  const scale = longSide < 1400 ? 3 : longSide < 2600 ? 2 : 1.35;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // Kontrastøkning + mild terskling. Bakgrunnen blir hvit, tekst blir mørk.
    const contrasted = Math.max(0, Math.min(255, (luma - 128) * 1.45 + 128));
    const value = contrasted < 182 ? 0 : 255;

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function receiptSourceToDataUrl(source: string | File) {
  if (typeof source === "string") return Promise.resolve(source);

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Kunne ikke lese bildefilen."));
    reader.readAsDataURL(source);
  });
}

export default function MobileScanPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanningRef = useRef(false);
  const receiptConfirmedRef = useRef(false);
  const lastReceiptAnalysisAtRef = useRef(0);
  const lastScanRef = useRef<{ ean: string; at: number }>({ ean: "", at: 0 });

  const [mode, setMode] = useState<MobileMode>("in");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraPaused, setCameraPaused] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualEan, setManualEan] = useState("");
  const [lastResult, setLastResult] = useState<ScanResponse["data"] | null>(null);
  const [message, setMessage] = useState("Velg modus og pek kameraet mot strekkoden.");
  const [error, setError] = useState<string | null>(null);
  const [receiptText, setReceiptText] = useState("");
  const [receiptAiLines, setReceiptAiLines] = useState<ReceiptLine[] | null>(null);
  const [receiptStoreKey, setReceiptStoreKey] = useState("");
  const [receiptStoreVerified, setReceiptStoreVerified] = useState(false);
  const [receiptCache, setReceiptCache] = useState<ReceiptCache | null>(null);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [receiptDetected, setReceiptDetected] = useState(false);
  const [receiptCandidateScore, setReceiptCandidateScore] = useState(0);
  const [receiptProcessing, setReceiptProcessing] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [storeDetectionMessage, setStoreDetectionMessage] = useState<string | null>(null);
  const [shelfStoreKey, setShelfStoreKey] = useState("");
  const [shelfEan, setShelfEan] = useState("");
  const [shelfPrice, setShelfPrice] = useState("");
  const [shelfText, setShelfText] = useState("");
  const [shelfImageUrl, setShelfImageUrl] = useState<string | null>(null);

  const parsedReceiptLines = useMemo(() => receiptAiLines ?? parseReceiptText(receiptText), [receiptAiLines, receiptText]);
  const activeReceiptLines = receiptCache?.lines.filter((line) => !line.usedAt) ?? [];
  const receiptMinutesLeft = receiptCache ? Math.max(0, Math.ceil((Date.parse(receiptCache.expiresAt) - Date.now()) / 60000)) : 0;
  const activeStoreOptions = useMemo(() => storeOptions.filter((store) => store.isEnabled !== false), [storeOptions]);
  const selectedReceiptStore = storeOptions.find((store) => store.storeKey === receiptStoreKey) ?? null;
  const selectedShelfStore = activeStoreOptions.find((store) => store.storeKey === shelfStoreKey) ?? null;
  const receiptCaptureMode = mode === "receipt" && !receiptCache;
  const receiptItemScanMode = mode === "receipt" && Boolean(receiptCache);

  function saveReceiptCache() {
    if (!selectedReceiptStore) {
      setError("Velg hvilken lagret butikk kvitteringen kommer fra før du lagrer prisbufferen.");
      return;
    }

    if (!receiptStoreVerified) {
      setError("Velg butikk før kvitteringen skannes, slik at prisene ikke havner på feil butikk.");
      return;
    }

    if (!parsedReceiptLines.length) {
      setError("Fant ingen varelinjer med pris. Prøv et tydeligere bilde, last opp fil, eller juster teksten manuelt.");
      return;
    }

    const now = new Date();
    const cache: ReceiptCache = {
      storeKey: selectedReceiptStore.storeKey,
      storeName: selectedReceiptStore.storeName,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
      lines: parsedReceiptLines
    };

    writeReceiptCache(cache);
    setReceiptCache(cache);
    setReceiptText("");
    setReceiptAiLines(null);
    if (receiptImageUrl) URL.revokeObjectURL(receiptImageUrl);
    setReceiptImageUrl(null);
    setOcrStatus(null);
    setReceiptDetected(false);
    setReceiptCandidateScore(0);
    setError(null);
    setMessage(`${cache.lines.length} kvitteringslinjer lagret i 1 time. Skann EAN på varene for å koble prisene.`);
  }

  function clearReceiptCache() {
    writeReceiptCache(null);
    setReceiptCache(null);
    setMessage("Midlertidig kvittering er tømt.");
  }

  function markReceiptLineUsed(lineId: string, productName: string) {
    setReceiptCache((current) => {
      if (!current) return current;

      const updated: ReceiptCache = {
        ...current,
        lines: current.lines.map((line) =>
          line.id === lineId ? { ...line, usedAt: new Date().toISOString(), matchedProductName: productName } : line
        )
      };

      writeReceiptCache(updated);
      return updated;
    });
  }

  async function runReceiptOcr(source: string | File) {
    setReceiptProcessing(true);
    setError(null);
    setReceiptAiLines(null);
    setReceiptText("");
    setOcrStatus("Leser kvittering med AI...");

    try {
      const imageBase64 = await imageSourceToDataUrl(source);
      const aiResponse = await authFetch("/api/mobile/receipt-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 })
      });

      const aiPayload = (await aiResponse.json().catch(() => null)) as ReceiptAiResponse | null;

      if (!aiResponse.ok) {
        throw new Error(aiPayload?.error ?? "AI-kvitteringslesing feilet.");
      }

      const aiItems = aiPayload?.data?.items ?? [];
      const aiLines = aiItems
        .map(receiptLineFromAiItem)
        .filter((line): line is ReceiptLine => line !== null);

      if (!aiLines.length) {
        throw new Error("AI fant ingen sikre varelinjer på kvitteringen.");
      }

      const aiStoreKey = aiPayload?.data?.storeKey ?? null;
      const aiStoreName = aiPayload?.data?.storeName ?? null;

      if (!aiStoreKey || !aiStoreName) {
        throw new Error("AI fant varelinjer, men kunne ikke koble kvitteringen til en registrert butikk. Legg til/rydd butikken i systemet og prøv igjen.");
      }

      const now = new Date();
      const cache: ReceiptCache = {
        storeKey: aiStoreKey,
        storeName: aiStoreName,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
        lines: aiLines
      };

      writeReceiptCache(cache);
      setReceiptCache(cache);
      setReceiptStoreKey(aiStoreKey);
      setReceiptStoreVerified(true);
      setStoreDetectionMessage(`AI valgte registrert butikk: ${aiStoreName}.`);
      setReceiptText("");
      setReceiptAiLines(null);
      if (receiptImageUrl) URL.revokeObjectURL(receiptImageUrl);
      setReceiptImageUrl(null);
      setOcrStatus(null);
      setReceiptDetected(false);
      setReceiptCandidateScore(0);
      setError(null);

      const aiWarnings = Array.isArray(aiPayload?.data?.warnings) ? aiPayload.data.warnings.filter(Boolean) : [];
      setMessage(
        aiWarnings.length
          ? `AI la ${aiLines.length} kvitteringslinjer rett i aktiv kvittering for ${aiStoreName}. ${aiWarnings.join(" ")}`
          : `AI la ${aiLines.length} kvitteringslinjer rett i aktiv kvittering for ${aiStoreName}. Skann EAN på varene.`
      );
      beep(true);
    } catch (error) {
      beep(false);
      const message = error instanceof Error ? error.message : "AI klarte ikke å lese kvitteringen.";
      setOcrStatus(null);
      setError(message);
      setMessage("Kvitteringen ble ikke lagret. Prøv et tydeligere bilde, eller sjekk at butikken er registrert.");
    } finally {
      setReceiptProcessing(false);
    }
  }

  async function captureReceiptFromCamera() {
    const video = videoRef.current;
    if (!video) return;

    const dataUrl = captureVideoFrame(video);
    if (!dataUrl) {
      setError("Kunne ikke hente bilde fra kameraet.");
      return;
    }

    if (receiptImageUrl) URL.revokeObjectURL(receiptImageUrl);
    setReceiptImageUrl(dataUrl);
    await runReceiptOcr(dataUrl);
  }


  function chooseReceiptStore(store: StoreOption) {
    setReceiptStoreKey(store.storeKey);
    setReceiptStoreVerified(true);
    setStoreDetectionMessage(`Butikk bekreftet: ${store.storeName}.`);
  }

  function chooseShelfStore(store: StoreOption) {
    setShelfStoreKey(store.storeKey);
  }

  async function runShelfOcr(source: string | File) {
    setReceiptProcessing(true);
    setError(null);
    setOcrStatus("Leser hyllekant...");

    try {
      const Tesseract = await import("tesseract.js");
      const result = await Tesseract.recognize(source, "nor+eng", {
        logger: (progress: TesseractProgress) => {
          if (progress.status === "recognizing text" && typeof progress.progress === "number") {
            setOcrStatus(`Leser hyllekant ${Math.round(progress.progress * 100)} %`);
          } else if (progress.status) {
            setOcrStatus(progress.status);
          }
        }
      });

      const text = result.data.text.trim();
      const price = parseShelfPrice(text);
      const eanFromText = parseShelfEan(text);
      setShelfText(text);
      if (price !== null) setShelfPrice(price.toFixed(2));
      if (eanFromText && !shelfEan) setShelfEan(eanFromText);
      setOcrStatus(price !== null ? "Hyllekant lest. Kontroller EAN og pris før lagring." : "Fant tekst, men ingen sikker pris. Skriv pris manuelt.");
      beep(price !== null || Boolean(eanFromText));
    } catch (ocrError) {
      beep(false);
      setError(ocrError instanceof Error ? ocrError.message : "Kunne ikke lese hyllekanten automatisk");
      setOcrStatus("OCR feilet. Prøv et skarpere bilde eller skriv EAN/pris manuelt.");
    } finally {
      setReceiptProcessing(false);
    }
  }

  async function captureShelfFromCamera() {
    if (!selectedShelfStore) {
      setError("Velg hvilken lagret butikk du står i før du leser hyllekant.");
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const dataUrl = captureVideoFrame(video);
    if (!dataUrl) {
      setError("Kunne ikke hente bilde fra kameraet.");
      return;
    }

    if (shelfImageUrl) URL.revokeObjectURL(shelfImageUrl);
    setShelfImageUrl(dataUrl);
    await runShelfOcr(dataUrl);
  }

  async function saveShelfPrice() {
    const ean = cleanEan(shelfEan);
    const price = parsePrice(shelfPrice);

    if (!selectedShelfStore) {
      setError("Velg hvilken lagret butikk du står i før du lagrer hyllekantprisen.");
      return;
    }

    if (ean.length < 6) {
      setError("Skriv eller skann EAN fra hyllekanten før du lagrer.");
      return;
    }

    if (price === null || price <= 0) {
      setError("Skriv en gyldig pris fra hyllekanten før du lagrer.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage("Lagrer hyllekantpris...");

    try {
      const response = await authFetch("/api/mobile/shelf-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ean,
          price,
          storeKey: selectedShelfStore.storeKey,
          storeName: selectedShelfStore.storeName,
          rawText: shelfText
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        beep(false);
        setError(payload?.error ?? "Kunne ikke lagre hyllekantpris");
        return;
      }

      beep(true);
      setShelfEan("");
      setShelfPrice("");
      setShelfText("");
      setMessage(`Hyllekantpris lagret for ${payload?.data?.product?.name ?? ean}: ${price.toFixed(2)} kr hos ${payload?.data?.storeName ?? selectedShelfStore.storeName}.`);
    } catch (saveError) {
      beep(false);
      setError(saveError instanceof Error ? saveError.message : "Kunne ikke lagre hyllekantpris");
    } finally {
      setBusy(false);
    }
  }

  async function submitScan(rawEan: string, selectedMode: ScanMode = mode === "out" ? "out" : "in") {
    const ean = cleanEan(rawEan);
    if (ean.length < 6 || busy) return;

    const now = Date.now();
    const last = lastScanRef.current;
    if (last.ean === ean && now - last.at < 1800) return;
    lastScanRef.current = { ean, at: now };

    setBusy(true);
    setError(null);
    setMessage(`Fant ${ean}. Oppdaterer lager...`);

    try {
      const response = await authFetch("/api/mobile/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ean,
          mode: selectedMode,
          receipt: receiptCache
            ? {
                storeKey: receiptCache.storeKey,
                storeName: receiptCache.storeName,
                observedAt: receiptCache.createdAt,
                lines: activeReceiptLines.map((line) => ({
                  id: line.id,
                  text: line.text,
                  price: line.price,
                  quantity: line.quantity,
                  quantityUnit: line.quantityUnit,
                  unitPrice: line.unitPrice,
                  totalPrice: line.totalPrice
                }))
              }
            : undefined
        })
      });

      const payload = (await response.json().catch(() => null)) as ScanResponse | null;

      if (!response.ok) {
        beep(false);
        setError(payload?.error ?? "Kunne ikke oppdatere lager");
        setMessage(payload?.message ?? "Prøv igjen, eller legg varen til i basisutvalget først.");
        return;
      }

      beep(true);
      setLastResult(payload?.data ?? null);
      setManualEan("");

      if (payload?.data?.receiptPriceMatch?.inserted) {
        const receiptMatch = payload.data.receiptPriceMatch;
        markReceiptLineUsed(receiptMatch.lineId, payload.data.product.name);
        const quantityText = ` (${formatReceiptQuantity(receiptMatch.quantity, receiptMatch.quantityUnit ?? "stk")})`;
        const warningText = receiptMatch.warning ? ` ${receiptMatch.warning}` : "";
        setMessage(`Piip! Pris fra kvittering matchet: ${formatReceiptPrice(receiptMatch.unitPrice)} kr/stk${quantityText}.${warningText}`);
      } else {
        setMessage(selectedMode === "in" ? "Piip! Lagt inn på lager." : "Piip! Tatt ut av lager.");
      }
    } catch (scanError) {
      beep(false);
      setError(scanError instanceof Error ? scanError.message : "Kunne ikke oppdatere lager");
    } finally {
      setBusy(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }

  async function scanNextItem() {
    setCameraPaused(false);
    setError(null);
    setMessage("Klar for neste vare.");
    await startCamera();
  }

  async function startCamera() {
    setCameraError(null);
    setCameraPaused(false);

    try {
      if (window.BarcodeDetector) {
        detectorRef.current = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraReady(true);

      if (!window.BarcodeDetector) {
        setCameraError("Denne nettleseren støtter ikke strekkodeskanning direkte. Kvitteringsmodus virker fortsatt, og EAN kan legges inn manuelt.");
      }
    } catch (cameraErrorValue) {
      setCameraError(cameraErrorValue instanceof Error ? cameraErrorValue.message : "Fikk ikke startet kameraet");
    }
  }

  useEffect(() => {
    setReceiptCache(readReceiptCache());

    authFetch("/api/mobile/stores")
      .then((response) => response.json())
      .then((payload) => {
        const stores = ((payload?.data?.stores ?? []) as StoreOption[]).filter((store) => store.isEnabled !== false);
        setStoreOptions(stores);
        setReceiptStoreKey("");
        setReceiptStoreVerified(false);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    receiptConfirmedRef.current = false;
    setReceiptDetected(false);
    setReceiptCandidateScore(0);
  }, [mode]);

  useEffect(() => {
    if (!cameraReady) return;

    const timer = window.setTimeout(() => {
      stopCamera();
      setCameraPaused(true);
      setMessage("Kameraet er pauset etter 1 minutt. Trykk Skann neste vare for å fortsette.");
    }, 60_000);

    return () => window.clearTimeout(timer);
  }, [cameraReady]);

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      if (cancelled) return;

      const video = videoRef.current;
      const detector = detectorRef.current;

      if (receiptCaptureMode && cameraReady && video && video.readyState >= 2) {
        const now = Date.now();
        if (now - lastReceiptAnalysisAtRef.current > 450) {
          lastReceiptAnalysisAtRef.current = now;
          const canvas = analysisCanvasRef.current ?? document.createElement("canvas");
          analysisCanvasRef.current = canvas;
          const analysis = analyzeReceiptFrame(video, canvas);

          if (analysis) {
            setReceiptCandidateScore(analysis.score);
            setReceiptDetected(analysis.isReceipt);

            if (analysis.isReceipt && !receiptConfirmedRef.current) {
              receiptConfirmedRef.current = true;
              beep(true);
              setMessage("Kvittering gjenkjent. Hold stille og trykk ‘Ta bilde og les’. ");
            } else if (!analysis.isReceipt && receiptConfirmedRef.current && analysis.score < 42) {
              receiptConfirmedRef.current = false;
            }
          }
        }
      }

      if ((mode !== "receipt" || receiptItemScanMode) && !busy && cameraReady && video && detector && video.readyState >= 2 && !scanningRef.current) {
        scanningRef.current = true;
        try {
          const codes = await detector.detect(video);
          const ean = cleanEan(codes[0]?.rawValue ?? "");
          const selectedScanMode: ScanMode = receiptItemScanMode ? "in" : mode === "out" ? "out" : "in";
          if (ean) await submitScan(ean, selectedScanMode);
        } catch {
          // Ignore single-frame scanner errors. The next animation frame tries again.
        } finally {
          scanningRef.current = false;
        }
      }

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    return () => {
      cancelled = true;
    };
  }, [busy, cameraReady, mode, receiptCache, receiptCaptureMode, receiptItemScanMode]);

  useEffect(() => {
    startCamera().catch(() => undefined);

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (receiptImageUrl) URL.revokeObjectURL(receiptImageUrl);
      if (shelfImageUrl) URL.revokeObjectURL(shelfImageUrl);
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">Mobil lager</p>
            <h1 className="text-3xl font-black">Piip varer</h1>
          </div>
          <a href="/dashboard" className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15">
            Dashboard
          </a>
        </header>

        <section className="mt-5 grid grid-cols-3 gap-2 rounded-3xl bg-white/8 p-2 ring-1 ring-white/10">
          <button
            onClick={() => setMode("in")}
            className={`rounded-2xl px-3 py-4 text-left transition ${mode === "in" ? "bg-emerald-400 text-slate-950" : "bg-white/5 text-white"}`}
          >
            <span className="block text-3xl">+</span>
            <span className="mt-2 block text-base font-black">Inn</span>
            <span className="text-xs opacity-80">Øk lager</span>
          </button>

          <button
            onClick={() => setMode("out")}
            className={`rounded-2xl px-3 py-4 text-left transition ${mode === "out" ? "bg-amber-300 text-slate-950" : "bg-white/5 text-white"}`}
          >
            <span className="block text-3xl">−</span>
            <span className="mt-2 block text-base font-black">Ut</span>
            <span className="text-xs opacity-80">Reduser</span>
          </button>

          <button
            onClick={() => setMode("receipt")}
            className={`rounded-2xl px-3 py-4 text-left transition ${mode === "receipt" ? "bg-sky-300 text-slate-950" : "bg-white/5 text-white"}`}
          >
            <span className="block text-3xl">⌁</span>
            <span className="mt-2 block text-base font-black">Kvittering</span>
            <span className="text-xs opacity-80">Prisbuffer</span>
          </button>

        </section>

        <section className="relative mt-5 overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
          <video ref={videoRef} className={`${receiptCaptureMode ? "aspect-[9/16] max-h-[72vh]" : "aspect-video"} w-full object-cover`} muted playsInline />
          {!receiptCaptureMode || receiptItemScanMode ? (
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-28 -translate-y-1/2 rounded-3xl border-4 border-emerald-300/80 shadow-[0_0_0_999px_rgba(2,6,23,0.45)]" />
          ) : (
            <div className="pointer-events-none absolute inset-0 px-8 py-6">
              <div
                className={`mx-auto flex h-full max-w-[58%] flex-col items-center justify-center rounded-3xl border-4 text-center shadow-[0_0_0_999px_rgba(2,6,23,0.40)] transition ${
                  receiptDetected ? "border-sky-300 bg-sky-300/20" : "border-white/45 bg-slate-950/15"
                }`}
              >
                <p className="text-2xl font-black">{receiptDetected ? "Kvittering funnet" : "Finn kvittering"}</p>
                <p className="mt-2 max-w-44 text-sm text-slate-100">
                  {receiptDetected ? "Piip! Hold stille og ta bilde." : "Hold kvitteringen innenfor rammen."}
                </p>
                <p className="mt-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-bold">Treff: {receiptCandidateScore}%</p>
              </div>
            </div>
          )}
          <div className="absolute left-4 top-4 rounded-full bg-slate-950/75 px-4 py-2 text-sm font-bold">
            {cameraReady ? `Klar: ${mobileModeText(mode)}` : cameraPaused ? "Kameraet er pauset" : "Starter kamera..."}
          </div>
          {cameraPaused ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/75 px-6 text-center">
              <button type="button" onClick={scanNextItem} className="rounded-3xl bg-emerald-300 px-6 py-5 text-xl font-black text-slate-950">
                Skann neste vare
              </button>
            </div>
          ) : null}
          {busy || receiptProcessing ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/70 px-6 text-center text-xl font-black">
              {receiptProcessing ? ocrStatus ?? "Leser kvittering..." : "Oppdaterer lager..."}
            </div>
          ) : null}
        </section>

        {mode === "receipt" ? (
          <section className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={captureReceiptFromCamera}
              disabled={!cameraReady || receiptProcessing}
              className="rounded-2xl bg-sky-300 px-4 py-4 text-base font-black text-slate-950 disabled:opacity-50"
            >
              Ta bilde og les
            </button>
            <label className="rounded-2xl bg-white/10 px-4 py-4 text-center text-base font-black text-white ring-1 ring-white/15">
              Last opp fil
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (receiptImageUrl) URL.revokeObjectURL(receiptImageUrl);
      if (shelfImageUrl) URL.revokeObjectURL(shelfImageUrl);
                  const url = URL.createObjectURL(file);
                  setReceiptImageUrl(url);
                  runReceiptOcr(file).catch(() => undefined);
                }}
                className="hidden"
              />
            </label>
          </section>
        ) : null}

        {cameraError ? (
          <div className="mt-4 rounded-2xl bg-amber-300/15 p-4 text-sm text-amber-100 ring-1 ring-amber-200/20">
            {cameraError}
          </div>
        ) : null}

        {receiptCache ? (
          <section className="mt-4 rounded-3xl bg-sky-300 p-4 text-slate-950 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] opacity-70">Aktiv kvittering</p>
                <p className="mt-1 text-xl font-black">{receiptCache.storeName} · {activeReceiptLines.length} linjer igjen</p>
                <p className="mt-1 text-sm font-semibold opacity-80">Utløper om ca. {receiptMinutesLeft} min.</p>
                <p className="mt-1 text-xs font-bold opacity-70">Viser alle ubrukte kvitteringslinjer.</p>
              </div>
              <button onClick={clearReceiptCache} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white">
                Tøm
              </button>
            </div>
            <div className="mt-3 max-h-[65vh] space-y-2 overflow-auto rounded-2xl bg-white/55 p-3 text-sm">
              {activeReceiptLines.map((line) => (
                <div key={line.id} className={`flex justify-between gap-3 ${line.usedAt ? "opacity-45 line-through" : ""}`}>
                  <span className="min-w-0 truncate">{line.text}</span>
                  <span className="shrink-0 text-right font-black">
                    {formatReceiptQuantity(line.quantity, line.quantityUnit ?? "stk")} · {formatReceiptPrice(line.unitPrice ?? line.price)} kr/stk
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}


        {error ? (
          <div className="mt-4 rounded-2xl bg-red-300/15 p-4 text-sm font-bold text-red-100 ring-1 ring-red-200/20">
            {error}
          </div>
        ) : null}

      </div>
    </main>
  );
}
