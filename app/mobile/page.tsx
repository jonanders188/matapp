"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

type ScanMode = "in" | "out";
type MobileMode = ScanMode | "receipt" | "shelf";

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
  usedAt?: string;
  matchedProductName?: string;
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
      storeName: string;
      inserted: boolean;
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
  if (mode === "shelf") return "Hyllekant";
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
    .replace(/^\d+\s*[xX*]\s*/g, "")
    .replace(/\b\d+\s*(?:stk|x)\b/gi, "")
    .replace(/\b(?:a|b|mva|mvafri|kg|stk)\b\s*$/gi, "")
    .replace(/[=*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReceiptCandidateLines(text: string) {
  const sourceLines = text
    .split(/\r?\n/)
    .map(normalizeReceiptOcrLine)
    .filter(Boolean);

  const candidates: string[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    candidates.push(line);

    const prices = extractReceiptPrices(line);
    const hasLetters = /[a-zæøå]/i.test(line);

    if (!prices.length && hasLetters) {
      const next = sourceLines[index + 1];
      if (next && extractReceiptPrices(next).length && !/[a-zæøå]{3,}/i.test(next)) {
        candidates.push(`${line} ${next}`);
      }
    }
  }

  return candidates;
}

function parseReceiptText(text: string): ReceiptLine[] {
  const seen = new Set<string>();

  return buildReceiptCandidateLines(text)
    .map((line) => {
      if (line.length < 4) return null;
      if (receiptLineLooksLikeNoise(line) || receiptLineLooksLikeDiscount(line) || receiptLineLooksLikePaymentOrMeta(line)) return null;

      const prices = extractReceiptPrices(line);
      if (!prices.length) return null;

      const price = prices[prices.length - 1];
      const textPart = cleanReceiptProductText(line.slice(0, price.index));
      if (textPart.length < 3 || !/[a-zæøå]/i.test(textPart)) return null;
      if (/^\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk)?$/i.test(textPart)) return null;

      const dedupeKey = `${textPart.toLowerCase()}-${price.value.toFixed(2)}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);

      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: textPart,
        price: price.value
      } satisfies ReceiptLine;
    })
    .filter((line): line is ReceiptLine => Boolean(line));
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

export default function MobileScanPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanningRef = useRef(false);
  const receiptConfirmedRef = useRef(false);
  const lastReceiptAnalysisAtRef = useRef(0);
  const lastScanRef = useRef<{ ean: string; at: number }>({ ean: "", at: 0 });
  const shelfAutoCaptureRef = useRef(false);
  const lastShelfAutoSaveRef = useRef<{ ean: string; at: number }>({ ean: "", at: 0 });
  const cameraStartIdRef = useRef(0);

  const [mode, setMode] = useState<MobileMode>("in");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualEan, setManualEan] = useState("");
  const [lastResult, setLastResult] = useState<ScanResponse["data"] | null>(null);
  const [message, setMessage] = useState("Velg modus og pek kameraet mot strekkoden.");
  const [error, setError] = useState<string | null>(null);
  const [receiptText, setReceiptText] = useState("");
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

  const parsedReceiptLines = useMemo(() => parseReceiptText(receiptText), [receiptText]);
  const activeReceiptLines = receiptCache?.lines.filter((line) => !line.usedAt) ?? [];
  const receiptMinutesLeft = receiptCache ? Math.max(0, Math.ceil((Date.parse(receiptCache.expiresAt) - Date.now()) / 60000)) : 0;
  const receiptStoreCandidates = useMemo(() => detectStoreCandidatesFromText(receiptText, storeOptions), [receiptText, storeOptions]);
  const selectedReceiptStore = storeOptions.find((store) => store.storeKey === receiptStoreKey) ?? null;
  const selectedShelfStore = storeOptions.find((store) => store.storeKey === shelfStoreKey) ?? null;

  function saveReceiptCache() {
    if (!selectedReceiptStore) {
      setError("Velg hvilken lagret butikk kvitteringen kommer fra før du lagrer prisbufferen.");
      return;
    }

    if (!receiptStoreVerified) {
      setError("Bekreft butikk etter at kvitteringen er lest, slik at prisene ikke havner på feil butikk.");
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
    setOcrStatus("Starter tekstgjenkjenning...");

    try {
      const Tesseract = await import("tesseract.js");
      const result = await Tesseract.recognize(source, "nor+eng", {
        logger: (progress: TesseractProgress) => {
          if (progress.status === "recognizing text" && typeof progress.progress === "number") {
            setOcrStatus(`Leser kvittering ${Math.round(progress.progress * 100)} %`);
          } else if (progress.status) {
            setOcrStatus(progress.status);
          }
        }
      });

      const text = result.data.text.trim();
      setReceiptText(text);
      const candidates = detectStoreCandidatesFromText(text, storeOptions);
      setReceiptStoreVerified(false);
      if (candidates.length === 1) {
        setReceiptStoreKey(candidates[0].storeKey);
        setStoreDetectionMessage(`Butikk foreslått: ${candidates[0].storeName}. Bekreft butikken før du lagrer.`);
      } else if (candidates.length > 1) {
        setReceiptStoreKey("");
        setStoreDetectionMessage("Flere mulige butikker funnet. Velg riktig butikk før du lagrer.");
      } else if (text) {
        setReceiptStoreKey("");
        setStoreDetectionMessage("Fant ikke sikker butikk i kvitteringen. Velg riktig lagret butikk manuelt.");
      }
      setOcrStatus(text ? "Tekst lest. Sjekk linjene og lagre prisbufferen." : "OCR fant ikke tekst. Prøv et skarpere bilde.");

      if (parseReceiptText(text).length) {
        beep(true);
        setMessage("Kvittering lest. Kontroller varelinjene og lagre dem i 1 time.");
      } else {
        beep(false);
        setError("Fant tekst, men ingen tydelige varelinjer med pris. Du kan justere teksten manuelt før lagring.");
      }
    } catch (ocrError) {
      beep(false);
      setError(ocrError instanceof Error ? ocrError.message : "Kunne ikke lese kvitteringen automatisk");
      setOcrStatus("OCR feilet. Du kan laste opp et tydeligere bilde eller lime inn tekst manuelt.");
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

  function shelfInfoLooksSafe(ean: string, price: number | null, text: string) {
    if (!selectedShelfStore) return false;
    if (cleanEan(ean).length < 6) return false;
    if (price === null || price <= 0 || price > 5000) return false;
    if (text.trim().length < 4) return false;
    return true;
  }

  async function saveShelfPriceValues(eanValue: string, priceValue: number, rawText: string, auto = false) {
    const ean = cleanEan(eanValue);

    if (!selectedShelfStore) {
      setError("Velg hvilken lagret butikk du står i før du lagrer hyllekantprisen.");
      return false;
    }

    if (ean.length < 6) {
      setError("Skriv eller skann EAN fra hyllekanten før du lagrer.");
      return false;
    }

    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      setError("Skriv en gyldig pris fra hyllekanten før du lagrer.");
      return false;
    }

    setBusy(true);
    setError(null);
    setMessage(auto ? "EAN og pris funnet. Lagrer hyllekantpris automatisk..." : "Lagrer hyllekantpris...");

    try {
      const response = await authFetch("/api/mobile/shelf-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ean,
          price: priceValue,
          storeKey: selectedShelfStore.storeKey,
          storeName: selectedShelfStore.storeName,
          rawText
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        beep(false);
        setError(payload?.error ?? "Kunne ikke lagre hyllekantpris");
        return false;
      }

      beep(true);
      setShelfEan("");
      setShelfPrice("");
      setShelfText("");
      setMessage(`${auto ? "Auto-lagret" : "Hyllekantpris lagret"} for ${payload?.data?.product?.name ?? ean}: ${priceValue.toFixed(2)} kr hos ${payload?.data?.storeName ?? selectedShelfStore.storeName}.`);
      return true;
    } catch (saveError) {
      beep(false);
      setError(saveError instanceof Error ? saveError.message : "Kunne ikke lagre hyllekantpris");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runShelfOcr(source: string | File, options?: { fallbackEan?: string; autoSaveWhenOk?: boolean }) {
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
      const finalEan = cleanEan(eanFromText || options?.fallbackEan || shelfEan);

      setShelfText(text);
      if (price !== null) setShelfPrice(price.toFixed(2));
      if (finalEan) setShelfEan(finalEan);

      if (options?.autoSaveWhenOk && shelfInfoLooksSafe(finalEan, price, text)) {
        setOcrStatus("EAN og pris ser ok ut. Lagrer automatisk...");
        await saveShelfPriceValues(finalEan, price as number, text, true);
        return;
      }

      setOcrStatus(price !== null ? "Hyllekant lest. Kontroller EAN og pris før lagring." : "Fant tekst, men ingen sikker pris. Skriv pris manuelt.");
      beep(price !== null || Boolean(finalEan));
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
    if (price === null) {
      setError("Skriv en gyldig pris fra hyllekanten før du lagrer.");
      return;
    }
    await saveShelfPriceValues(ean, price, shelfText, false);
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
                lines: activeReceiptLines.map((line) => ({ id: line.id, text: line.text, price: line.price }))
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
        markReceiptLineUsed(payload.data.receiptPriceMatch.lineId, payload.data.product.name);
        setMessage(`Piip! Pris fra kvittering matchet: ${payload.data.receiptPriceMatch.price.toFixed(2)} kr.`);
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

  async function startCamera() {
    const startId = cameraStartIdRef.current + 1;
    cameraStartIdRef.current = startId;
    setCameraReady(false);
    setCameraError(null);

    try {
      if (window.BarcodeDetector) {
        detectorRef.current = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
        });
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      if (cameraStartIdRef.current !== startId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch (playError) {
          const errorName = playError instanceof DOMException ? playError.name : "";
          if (errorName !== "AbortError" && errorName !== "NotAllowedError") {
            throw playError;
          }
        }
      }

      if (cameraStartIdRef.current !== startId) return;
      setCameraReady(true);

      if (!window.BarcodeDetector) {
        setCameraError("Denne nettleseren støtter ikke strekkodeskanning direkte. Kvitteringsmodus virker fortsatt, og EAN kan legges inn manuelt.");
      }
    } catch (cameraErrorValue) {
      if (cameraStartIdRef.current !== startId) return;
      const errorName = cameraErrorValue instanceof DOMException ? cameraErrorValue.name : "";
      if (errorName === "AbortError") return;
      setCameraReady(false);
      setCameraError(cameraErrorValue instanceof Error ? cameraErrorValue.message : "Fikk ikke startet kameraet");
    }
  }

  useEffect(() => {
    setReceiptCache(readReceiptCache());

    authFetch("/api/mobile/stores")
      .then((response) => response.json())
      .then((payload) => {
        const stores = (payload?.data?.stores ?? []) as StoreOption[];
        setStoreOptions(stores);
        setReceiptStoreKey("");
        setReceiptStoreVerified(false);
        setShelfStoreKey("");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    receiptConfirmedRef.current = false;
    setReceiptDetected(false);
    setReceiptCandidateScore(0);
    setError(null);
    setOcrStatus(null);

    if (mode !== "shelf") {
      setShelfEan("");
      setShelfPrice("");
      setShelfText("");
      setShelfImageUrl(null);
    }

    if (mode !== "receipt") {
      setReceiptText("");
      setReceiptStoreVerified(false);
      setStoreDetectionMessage(null);
      setReceiptImageUrl(null);
    }

    if (mode === "in" || mode === "out") {
      setMessage("Pek kameraet mot strekkoden.");
    } else if (mode === "receipt") {
      setMessage("Pek kameraet mot kvitteringen, eller last opp bilde.");
    } else {
      setMessage("Velg butikk, pek kameraet mot hyllekanten og la appen lagre automatisk når EAN og pris finnes.");
    }
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      if (cancelled) return;

      const video = videoRef.current;
      const detector = detectorRef.current;

      if (mode === "receipt" && cameraReady && video && video.readyState >= 2) {
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

      if (mode === "shelf" && selectedShelfStore && !busy && !receiptProcessing && cameraReady && video && detector && video.readyState >= 2 && !scanningRef.current) {
        scanningRef.current = true;
        try {
          const codes = await detector.detect(video);
          const ean = cleanEan(codes[0]?.rawValue ?? "");
          if (ean) {
            if (ean !== shelfEan) setShelfEan(ean);
            const now = Date.now();
            const last = lastShelfAutoSaveRef.current;
            const canAutoCapture = !shelfAutoCaptureRef.current && (last.ean !== ean || now - last.at > 10000);

            if (canAutoCapture) {
              const dataUrl = captureVideoFrame(video);
              if (dataUrl) {
                shelfAutoCaptureRef.current = true;
                lastShelfAutoSaveRef.current = { ean, at: now };
                if (shelfImageUrl) URL.revokeObjectURL(shelfImageUrl);
                setShelfImageUrl(dataUrl);
                setMessage(`Fant EAN ${ean}. Leser hyllekant automatisk...`);
                await runShelfOcr(dataUrl, { fallbackEan: ean, autoSaveWhenOk: true });
              }
            }
          }
        } catch {
          // Ignore shelf barcode detection errors.
        } finally {
          shelfAutoCaptureRef.current = false;
          scanningRef.current = false;
        }
      }

      if (mode !== "receipt" && mode !== "shelf" && !busy && cameraReady && video && detector && video.readyState >= 2 && !scanningRef.current) {
        scanningRef.current = true;
        try {
          const codes = await detector.detect(video);
          const ean = cleanEan(codes[0]?.rawValue ?? "");
          if (ean) await submitScan(ean, mode);
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
  }, [busy, cameraReady, mode, receiptCache, receiptProcessing, selectedShelfStore, shelfEan, shelfImageUrl]);

  useEffect(() => {
    startCamera().catch(() => undefined);

    return () => {
      cameraStartIdRef.current += 1;
      setCameraReady(false);
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
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
          <a href="/inventory" className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15">
            Lager
          </a>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4 rounded-3xl bg-white/8 p-2 ring-1 ring-white/10">
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

          <button
            onClick={() => setMode("shelf")}
            className={`rounded-2xl px-3 py-4 text-left transition ${mode === "shelf" ? "bg-violet-300 text-slate-950" : "bg-white/5 text-white"}`}
          >
            <span className="block text-3xl">▤</span>
            <span className="mt-2 block text-base font-black">Hylle</span>
            <span className="text-xs opacity-80">EAN + pris</span>
          </button>
        </section>

        <section className="relative mt-5 overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
          <video ref={videoRef} className="aspect-[3/4] w-full object-cover sm:aspect-video" muted playsInline />
          {mode !== "receipt" && mode !== "shelf" ? (
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-28 -translate-y-1/2 rounded-3xl border-4 border-emerald-300/80 shadow-[0_0_0_999px_rgba(2,6,23,0.45)]" />
          ) : mode === "receipt" ? (
            <div className="pointer-events-none absolute inset-0 px-6 py-8">
              <div
                className={`mx-auto flex h-full max-w-[72%] flex-col items-center justify-center rounded-3xl border-4 text-center shadow-[0_0_0_999px_rgba(2,6,23,0.40)] transition ${
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
          ) : (
            <div className="pointer-events-none absolute inset-0 px-6 py-8">
              <div className="mx-auto flex h-full max-w-[82%] flex-col items-center justify-center rounded-3xl border-4 border-violet-300 bg-violet-300/15 text-center shadow-[0_0_0_999px_rgba(2,6,23,0.40)]">
                <p className="text-2xl font-black">Hyllekant</p>
                <p className="mt-2 max-w-48 text-sm text-slate-100">Hold prisetiketten innenfor rammen. Når EAN/barcode finnes tar appen bilde, leser pris og lagrer automatisk hvis alt ser ok ut.</p>
                {shelfEan ? <p className="mt-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-bold">EAN: {shelfEan}</p> : null}
              </div>
            </div>
          )}
          <div className="absolute left-4 top-4 rounded-full bg-slate-950/75 px-4 py-2 text-sm font-bold">
            {cameraReady ? `Klar: ${mobileModeText(mode)}` : "Starter kamera..."}
          </div>
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

        {mode === "shelf" ? (
          <section className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={captureShelfFromCamera}
              disabled={!cameraReady || receiptProcessing || !selectedShelfStore}
              className="rounded-2xl bg-violet-300 px-4 py-4 text-base font-black text-slate-950 disabled:opacity-50"
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
                  if (!selectedShelfStore) {
                    setError("Velg hvilken lagret butikk du står i før du leser hyllekant.");
                    event.target.value = "";
                    return;
                  }
                  if (shelfImageUrl) URL.revokeObjectURL(shelfImageUrl);
                  const url = URL.createObjectURL(file);
                  setShelfImageUrl(url);
                  runShelfOcr(file).catch(() => undefined);
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

        {receiptCache && mode !== "shelf" ? (
          <section className="mt-4 rounded-3xl bg-sky-300 p-4 text-slate-950 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] opacity-70">Aktiv kvittering</p>
                <p className="mt-1 text-xl font-black">{receiptCache.storeName} · {activeReceiptLines.length} linjer igjen</p>
                <p className="mt-1 text-sm font-semibold opacity-80">Utløper om ca. {receiptMinutesLeft} min.</p>
              </div>
              <button onClick={clearReceiptCache} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white">
                Tøm
              </button>
            </div>
            <div className="mt-3 max-h-32 space-y-2 overflow-auto rounded-2xl bg-white/55 p-3 text-sm">
              {receiptCache.lines.slice(0, 12).map((line) => (
                <div key={line.id} className={`flex justify-between gap-3 ${line.usedAt ? "opacity-45 line-through" : ""}`}>
                  <span className="min-w-0 truncate">{line.text}</span>
                  <span className="font-black">{line.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {mode === "receipt" ? (
          <section className="mt-4 rounded-3xl bg-white p-4 text-slate-950 shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Les kvittering</p>
            <h2 className="mt-1 text-2xl font-black">Midlertidig prisbuffer</h2>
            <p className="mt-2 text-sm text-slate-600">
              Appen prøver å gjenkjenne en kvittering i kamerabildet og piper når den er funnet. Ta bilde, eller last opp fil.
              OCR-teksten kan justeres før den lagres i én time.
            </p>

            <div className="mt-4 grid gap-3">
              <label className="text-sm font-bold text-slate-700">Butikk</label>
              {storeDetectionMessage ? <div className="rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{storeDetectionMessage}</div> : null}
              {receiptStoreCandidates.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {receiptStoreCandidates.map((store) => (
                    <button
                      key={store.storeKey}
                      type="button"
                      onClick={() => chooseReceiptStore(store)}
                      className={`rounded-2xl px-4 py-3 text-left text-sm font-black ring-1 ${receiptStoreKey === store.storeKey ? "bg-sky-300 text-slate-950 ring-sky-400" : "bg-slate-50 text-slate-700 ring-slate-200"}`}
                    >
                      {store.storeName}
                    </button>
                  ))}
                </div>
              ) : null}
              <select
                value={receiptStoreKey}
                onChange={(event) => {
                  const store = storeOptions.find((candidate) => candidate.storeKey === event.target.value);
                  if (store) chooseReceiptStore(store);
                  else {
                    setReceiptStoreKey("");
                    setReceiptStoreVerified(false);
                  }
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-lg font-semibold outline-none focus:border-sky-500"
              >
                <option value="">Velg butikk</option>
                {storeOptions.map((store) => (
                  <option key={store.storeKey} value={store.storeKey}>{store.storeName}</option>
                ))}
              </select>
              {selectedReceiptStore && !receiptStoreVerified ? (
                <button
                  type="button"
                  onClick={() => chooseReceiptStore(selectedReceiptStore)}
                  className="rounded-2xl bg-sky-300 px-4 py-3 text-left text-sm font-black text-slate-950"
                >
                  Bekreft at kvitteringen er fra {selectedReceiptStore.storeName}
                </button>
              ) : null}
              {!storeOptions.length ? (
                <div className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                  Ingen butikker er lagret i systemet. Legg til butikker i Admin før du importerer kvitteringer.
                </div>
              ) : null}

              {receiptImageUrl ? <img src={receiptImageUrl} alt="" className="max-h-48 rounded-2xl border border-slate-200 object-contain" /> : null}

              {ocrStatus ? <div className="rounded-2xl bg-sky-50 p-3 text-sm font-semibold text-sky-800">{ocrStatus}</div> : null}

              <label className="text-sm font-bold text-slate-700">Kvitteringstekst</label>
              <textarea
                value={receiptText}
                onChange={(event) => {
                  const value = event.target.value;
                  setReceiptText(value);
                  const candidates = detectStoreCandidatesFromText(value, storeOptions);
                  setReceiptStoreVerified(false);
                  if (candidates.length === 1) {
                    setReceiptStoreKey(candidates[0].storeKey);
                    setStoreDetectionMessage(`Butikk foreslått: ${candidates[0].storeName}. Bekreft butikken før du lagrer.`);
                  } else if (candidates.length > 1) {
                    setReceiptStoreKey("");
                    setStoreDetectionMessage("Flere mulige butikker funnet. Velg riktig butikk før du lagrer.");
                  }
                }}
                rows={9}
                placeholder={"JASMINRIS 2KG ELDORADO 39.90\nLETTMELK 1.75L TINE 31.90"}
                className="rounded-2xl border border-slate-200 px-4 py-3 font-mono text-sm outline-none focus:border-sky-500"
              />

              <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                Fant <strong>{parsedReceiptLines.length}</strong> mulige varelinjer med pris.
              </div>

              <button
                onClick={saveReceiptCache}
                disabled={!parsedReceiptLines.length || receiptProcessing || !selectedReceiptStore || !receiptStoreVerified}
                className="rounded-2xl bg-sky-300 px-5 py-4 text-lg font-black text-slate-950 disabled:opacity-50"
              >
                Lagre kvittering i 1 time
              </button>
            </div>
          </section>
        ) : null}

        {mode === "shelf" ? (
          <section className="mt-4 rounded-3xl bg-white p-4 text-slate-950 shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Les hyllekant</p>
            <h2 className="mt-1 text-2xl font-black">Hyllepris</h2>
            <p className="mt-2 text-sm text-slate-600">
              Velg butikken du står i. Når kameraet finner EAN/barcode tar appen bilde, leser pris og lagrer automatisk hvis EAN og pris ser ok ut.
              Feltene under brukes bare hvis automatikk ikke treffer.
            </p>

            <div className="mt-4 grid gap-3">
              <label className="text-sm font-bold text-slate-700">Butikk</label>
              <select
                value={shelfStoreKey}
                onChange={(event) => {
                  const store = storeOptions.find((candidate) => candidate.storeKey === event.target.value);
                  if (store) chooseShelfStore(store);
                  else setShelfStoreKey("");
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-lg font-semibold outline-none focus:border-violet-500"
              >
                <option value="">Velg butikk</option>
                {storeOptions.map((store) => (
                  <option key={store.storeKey} value={store.storeKey}>{store.storeName}</option>
                ))}
              </select>
              {!selectedShelfStore ? (
                <div className="rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                  Velg en lagret butikk før kamera/OCR brukes til hyllekant. Appen oppretter ikke nye butikker fra hyllemodus.
                </div>
              ) : null}
              {!storeOptions.length ? (
                <div className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                  Ingen butikker er lagret i systemet. Legg til butikker i Admin før du lagrer hyllepriser.
                </div>
              ) : null}

              {shelfImageUrl ? <img src={shelfImageUrl} alt="" className="max-h-48 rounded-2xl border border-slate-200 object-contain" /> : null}
              {ocrStatus ? <div className="rounded-2xl bg-violet-50 p-3 text-sm font-semibold text-violet-800">{ocrStatus}</div> : null}

              <label className="text-sm font-bold text-slate-700">EAN</label>
              <input
                inputMode="numeric"
                value={shelfEan}
                onChange={(event) => setShelfEan(cleanEan(event.target.value))}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-lg font-semibold outline-none focus:border-violet-500"
                placeholder="Skann eller skriv EAN"
              />

              <label className="text-sm font-bold text-slate-700">Pris</label>
              <input
                inputMode="decimal"
                value={shelfPrice}
                onChange={(event) => setShelfPrice(event.target.value)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-lg font-semibold outline-none focus:border-violet-500"
                placeholder="39.90"
              />

              <label className="text-sm font-bold text-slate-700">OCR-tekst fra hyllekant</label>
              <textarea
                value={shelfText}
                onChange={(event) => {
                  const value = event.target.value;
                  setShelfText(value);
                  const price = parseShelfPrice(value);
                  const ean = parseShelfEan(value);
                  if (price !== null) setShelfPrice(price.toFixed(2));
                  if (ean && !shelfEan) setShelfEan(ean);
                }}
                rows={5}
                className="rounded-2xl border border-slate-200 px-4 py-3 font-mono text-sm outline-none focus:border-violet-500"
                placeholder={"Produktnavn\nEAN 703...\nKr 39,90"}
              />

              <button
                onClick={saveShelfPrice}
                disabled={busy || receiptProcessing || !selectedShelfStore || cleanEan(shelfEan).length < 6 || !parsePrice(shelfPrice)}
                className="rounded-2xl bg-violet-300 px-5 py-4 text-lg font-black text-slate-950 disabled:opacity-50"
              >
                Lagre hyllepris
              </button>
            </div>
          </section>
        ) : null}

        <section className="mt-4 rounded-3xl bg-white p-4 text-slate-950 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Status</p>
          <p className="mt-1 text-xl font-black">{message}</p>
          {error ? <p className="mt-2 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}

          {lastResult && mode !== "receipt" && mode !== "shelf" ? (
            <div className="mt-4 flex gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
              {lastResult.product.image_url ? (
                <img src={lastResult.product.image_url} alt="" className="h-20 w-20 rounded-2xl bg-white object-contain" />
              ) : (
                <div className="h-20 w-20 rounded-2xl bg-slate-200" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-black">{lastResult.product.name}</p>
                <p className="text-sm text-slate-500">
                  {[lastResult.product.brand, lastResult.product.package_size].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-2 text-sm font-bold">
                  {modeText(lastResult.mode)}: {lastResult.beforeQuantity} → {lastResult.afterQuantity}
                </p>
                {lastResult.receiptPriceMatch?.inserted ? (
                  <p className="mt-1 text-xs font-semibold text-sky-700">
                    Pris fra {lastResult.receiptPriceMatch.storeName}: {lastResult.receiptPriceMatch.price.toFixed(2)} kr.
                  </p>
                ) : null}
                {lastResult.createdProduct ? (
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    Nytt basisprodukt opprettet. {lastResult.priceObservationsInserted} priser lagret.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {mode !== "receipt" && mode !== "shelf" ? (
          <section className="mt-4 rounded-3xl bg-white/8 p-4 ring-1 ring-white/10">
            <label className="text-sm font-semibold text-slate-200">Manuell EAN hvis kamera ikke virker</label>
            <div className="mt-2 flex gap-2">
              <input
                inputMode="numeric"
                value={manualEan}
                onChange={(event) => setManualEan(event.target.value)}
                placeholder="Skriv/skann EAN"
                className="min-w-0 flex-1 rounded-2xl border-0 bg-white px-4 py-3 text-lg font-semibold text-slate-950 outline-none"
              />
              <button
                onClick={() => submitScan(manualEan)}
                disabled={busy || cleanEan(manualEan).length < 6}
                className="rounded-2xl bg-emerald-400 px-5 py-3 font-black text-slate-950 disabled:opacity-50"
              >
                Piip
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
