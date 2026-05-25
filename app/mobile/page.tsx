"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { StoreLogoBadge, displayUnitSuffix } from "./store-branding";

type BarcodeResult = { rawValue: string };

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement | HTMLImageElement | ImageBitmap): Promise<BarcodeResult[]>;
};

type StoreOption = {
  storeKey: string;
  storeName: string;
  isEnabled: boolean;
  priority: number;
};

type QuickProduct = {
  id: string | null;
  name: string;
  brand: string | null;
  ean: string;
  imageUrl: string | null;
  packageSize: string | null;
  category: string | null;
  source: "local" | "kassalapp" | "none";
};

type QuickPrice = {
  storeKey: string;
  storeName: string;
  price: number | null;
  unitPrice: number | null;
  observedAt: string | null;
  source: string | null;
  isFresh: boolean;
};

type QuickGroupPrice = {
  productId: string;
  productName: string;
  brand: string | null;
  ean: string | null;
  packageSize: string | null;
  storeKey: string;
  storeName: string;
  price: number | null;
  unitPrice: number | null;
  storedUnitPrice: number | null;
  unitPriceWasCorrected: boolean;
  comparisonUnit: string | null;
  observedAt: string | null;
  source: string | null;
  ageDays: number | null;
  isFresh: boolean;
  isStale: boolean;
};

type QuickProductGroup = {
  id: string;
  name: string;
  comparisonUnit: string | null;
  packageCount: number;
  scannedPackage: QuickGroupPrice | null;
  cheapest: QuickGroupPrice | null;
  priceOptions: QuickGroupPrice[];
};

type QuickLookup = {
  ean: string;
  product: QuickProduct | null;
  existsLocally: boolean;
  isBasis: boolean;
  prices: QuickPrice[];
  productGroup?: QuickProductGroup | null;
  kassalappMessage: string | null;
  savedPrice?: {
    price: number;
    storeKey: string;
    storeName: string;
    observedAt: string;
  };
};

type SaveMode = "none" | "global" | "basis";
type MobileScanMode = "update_price" | "best_prices";
type ScanPhase = "idle" | "ready" | "scanned" | "loading" | "found" | "not_found" | "saving" | "saved" | "error";

const PRODUCT_LOOKUP_MAX_ATTEMPTS = 5;

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

function cleanEan(value: string) {
  return value.replace(/\D/g, "").trim();
}

function kr(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 2 }).format(Number(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Ikke synket";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Ukjent dato";
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function unitLabel(unit: string | null | undefined) {
  if (unit === "kg") return "kr/kg";
  if (unit === "l") return "kr/l";
  if (unit === "stk") return "kr/stk";
  return "kr/enhet";
}

function parsePrice(value: string) {
  const number = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function groupPriceFreshnessLabel(price: QuickGroupPrice | null | undefined) {
  if (!price) return null;
  if (price.isFresh) return "Aktuell pris";
  if (price.isStale) return "Bør sjekkes";
  return "Bør sjekkes";
}

function groupPriceFreshnessClass(price: QuickGroupPrice | null | undefined) {
  if (!price) return "bg-slate-100 text-slate-600";
  if (price.isFresh) return "bg-emerald-50 text-emerald-700";
  return "bg-amber-50 text-amber-800";
}

function groupPriceAgeText(price: QuickGroupPrice | null | undefined) {
  if (!price || price.ageDays == null) return "Ukjent alder";
  if (price.ageDays === 0) return "i dag";
  if (price.ageDays === 1) return "i går";
  return `${price.ageDays} dager gammel`;
}

function unitSavingsText(scanned: QuickGroupPrice | null | undefined, cheapest: QuickGroupPrice | null | undefined) {
  if (!scanned || !cheapest) return null;
  if (scanned.productId === cheapest.productId) return null;
  if (scanned.unitPrice == null || cheapest.unitPrice == null) return null;
  if (scanned.comparisonUnit !== cheapest.comparisonUnit) return null;
  const diff = scanned.unitPrice - cheapest.unitPrice;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return `${kr(diff)} billigere per ${displayUnitSuffix(cheapest.comparisonUnit)}`;
}


function beep(kind: "scan" | "success" | "error" = "success") {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const master = ctx.createGain();
  master.gain.value = kind === "success" ? 0.16 : 0.1;
  master.connect(ctx.destination);

  const now = ctx.currentTime;
  const tones =
    kind === "success"
      ? [
          { hz: 660, at: 0, length: 0.07 },
          { hz: 880, at: 0.08, length: 0.08 },
          { hz: 1175, at: 0.17, length: 0.12 }
        ]
      : kind === "scan"
        ? [{ hz: 1046, at: 0, length: 0.06 }]
        : [
            { hz: 260, at: 0, length: 0.12 },
            { hz: 180, at: 0.14, length: 0.16 }
          ];

  for (const tone of tones) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = tone.hz;
    gain.gain.setValueAtTime(0.001, now + tone.at);
    gain.gain.exponentialRampToValueAtTime(1, now + tone.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + tone.at + tone.length);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now + tone.at);
    oscillator.stop(now + tone.at + tone.length + 0.02);
  }

  window.setTimeout(() => ctx.close().catch(() => undefined), 700);
}

function sourceBadge(product: QuickProduct | null) {
  if (!product) return "Ikke funnet";
  if (product.source === "local") return "I produktregisteret";
  if (product.source === "kassalapp") return "Fra Kassalapp";
  return "Ukjent";
}

function phaseTitle(phase: ScanPhase) {
  if (phase === "scanned") return "EAN lest";
  if (phase === "loading") return "Henter nåpris";
  if (phase === "found") return "Vare funnet";
  if (phase === "not_found") return "Vare ikke funnet";
  if (phase === "saving") return "Delr pris";
  if (phase === "saved") return "Pris lagret";
  if (phase === "error") return "Noe stoppet";
  if (phase === "ready") return "Klar til skanning";
  return "Velg butikk";
}

function phaseTone(phase: ScanPhase) {
  if (["found", "saved", "ready"].includes(phase)) return "bg-emerald-300/15 text-emerald-100 ring-emerald-300/20";
  if (["error", "not_found"].includes(phase)) return "bg-rose-400/15 text-rose-100 ring-rose-300/20";
  if (["scanned", "loading", "saving"].includes(phase)) return "bg-amber-300/15 text-amber-100 ring-amber-300/20";
  return "bg-white/10 text-slate-200 ring-white/10";
}

export default function MobileScanPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const priceInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanningRef = useRef(false);
  const lastScanRef = useRef<{ ean: string; at: number }>({ ean: "", at: 0 });
  const cameraStartIdRef = useRef(0);

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreKey, setSelectedStoreKey] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Velg butikk. Skann produkt. Oppdater pris hvis du vil.");
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentEan, setCurrentEan] = useState("");
  const [lookup, setLookup] = useState<QuickLookup | null>(null);
  const [manualPrice, setManualPrice] = useState("");
  const [saveMode, setSaveMode] = useState<SaveMode>("basis");
  const [mobileMode, setMobileMode] = useState<MobileScanMode>("best_prices");
  const [cameraPaused, setCameraPaused] = useState(false);

  const activeStores = useMemo(() => stores.filter((store) => store.isEnabled !== false), [stores]);
  const selectedStore = activeStores.find((store) => store.storeKey === selectedStoreKey) ?? null;
  const selectedStorePrice = lookup?.prices.find((price) => price.storeKey === selectedStoreKey) ?? null;
  const visibleStorePrices = useMemo(
    () => (lookup?.prices ?? []).filter((price) => price.price != null && Number.isFinite(Number(price.price))),
    [lookup?.prices]
  );
  const validGroupPrices = useMemo(
    () => (lookup?.productGroup?.priceOptions ?? []).filter((price) => (
      price.price != null &&
      Number.isFinite(Number(price.price)) &&
      price.unitPrice != null &&
      Number.isFinite(Number(price.unitPrice))
    )),
    [lookup?.productGroup?.priceOptions]
  );
  const scannedGroupPrice = lookup?.productGroup?.scannedPackage ?? null;
  const cheapestGroupPrice = lookup?.productGroup?.cheapest ?? null;
  const hasCheaperPackage = Boolean(
    scannedGroupPrice &&
    cheapestGroupPrice &&
    scannedGroupPrice.productId !== cheapestGroupPrice.productId &&
    scannedGroupPrice.unitPrice != null &&
    cheapestGroupPrice.unitPrice != null &&
    scannedGroupPrice.comparisonUnit === cheapestGroupPrice.comparisonUnit &&
    scannedGroupPrice.unitPrice > cheapestGroupPrice.unitPrice
  );
  const canScan = Boolean(selectedStore);
  const productIsUnsaved = Boolean(lookup?.product && !lookup.existsLocally);
  const hasResult = Boolean(lookup);


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
    setMessage(`Fant eksisterende butikkpris hos ${storeName}: ${kr(bestPrice.numericPrice)}. Kontroller og trykk Del.`);
  }, [lookup, selectedStoreKey, selectedStore?.storeName]);


  async function loadStores() {
    try {
      const response = await authFetch("/api/mobile/stores", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      const nextStores = ((payload?.data?.stores ?? []) as StoreOption[]).filter((store) => store.isEnabled !== false);
      setStores(nextStores);
      if (!selectedStoreKey && nextStores.length === 1) setSelectedStoreKey(nextStores[0].storeKey);
    } catch {
      setError("Kunne ikke hente aktive butikker.");
    }
  }

  async function fetchQuickLookupWithRetry(ean: string) {
    let lastPayload: unknown = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= PRODUCT_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
      try {
        setMessage(
          attempt === 1
            ? `EAN ${ean} lest. Henter nåpris...`
            : `Fant ikke varen ennå. Prøver igjen ${attempt}/${PRODUCT_LOOKUP_MAX_ATTEMPTS}...`
        );

        const response = await authFetch(`/api/mobile/quick-price?ean=${encodeURIComponent(ean)}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        lastPayload = payload;

        if (!response.ok) {
          lastError = payload?.error ?? "Kunne ikke hente varen.";
        } else {
          const data = payload?.data as QuickLookup;
          if (data?.product || attempt === PRODUCT_LOOKUP_MAX_ATTEMPTS) return data;
          lastError = data?.kassalappMessage ?? "Fant ikke varen.";
        }
      } catch (errorValue) {
        lastError = errorValue;
      }

      if (attempt < PRODUCT_LOOKUP_MAX_ATTEMPTS) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    }

    const message =
      lastError instanceof Error
        ? lastError.message
        : typeof lastError === "string"
          ? lastError
          : (lastPayload as { error?: string } | null)?.error ?? "Kunne ikke hente varen.";
    throw new Error(message);
  }

  async function lookupEan(rawEan: string) {
    const ean = cleanEan(rawEan);
    if (ean.length < 6) return;

    const now = Date.now();
    const last = lastScanRef.current;
    if (last.ean === ean && now - last.at < 1600) return;
    lastScanRef.current = { ean, at: now };

    if (!selectedStore) {
      beep("error");
      setPhase("error");
      setError("Velg hvilken butikk du står i før du skanner.");
      setMessage("Appen er låst til du har valgt butikk.");
      return;
    }

    beep("scan");
    setPhase("scanned");
    setBusy(true);
    setError(null);
    setCurrentEan(ean);
    setLookup(null);
    setManualPrice("");
    setMessage(`EAN ${ean} lest. Henter nåpris...`);
    window.setTimeout(() => setPhase("loading"), 120);

    try {
      const data = await fetchQuickLookupWithRetry(ean);
      setLookup(data);
      setSaveMode(data.existsLocally ? "none" : "basis");
      if (data.product) {
        beep("success");
        setPhase("found");
        setMessage(`${data.product.name} er hentet. Bekreft eller oppdater prisen.`);
      } else {
        beep("error");
        setPhase("not_found");
        setError(data.kassalappMessage ?? `Fant ikke varen etter ${PRODUCT_LOOKUP_MAX_ATTEMPTS} forsøk.`);
        setMessage("Skann samme vare på nytt eller prøv en annen vare.");
      }
    } catch (lookupError) {
      beep("error");
      setPhase("error");
      setError(lookupError instanceof Error ? lookupError.message : "Kunne ikke hente varen.");
    } finally {
      setBusy(false);
    }
  }

  async function savePrice(priceOverride?: number) {
    if (!selectedStore) {
      setError("Velg butikk før du lagrer pris.");
      return;
    }

    const ean = cleanEan(currentEan || lookup?.ean || "");
    const price = typeof priceOverride === "number" ? priceOverride : parsePrice(manualPrice);

    if (ean.length < 6) {
      setError("Skann eller skriv EAN først.");
      return;
    }

    if (price === null || price <= 0) {
      setError("Skriv en gyldig pris.");
      return;
    }

    if (productIsUnsaved && saveMode === "none") {
      setError("Varen må lagres globalt eller i basisutvalget før prisen kan lagres.");
      return;
    }

    beep("scan");
    setBusy(true);
    setPhase("saving");
    setError(null);
    setMessage(`Delr ${price.toFixed(2)} kr hos ${selectedStore.storeName}...`);

    try {
      const response = await authFetch("/api/mobile/quick-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ean,
          storeKey: selectedStore.storeKey,
          price,
          saveMode: lookup?.existsLocally ? "none" : saveMode
        })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        beep("error");
        setPhase("error");
        setError(payload?.error ?? "Kunne ikke lagre prisen.");
        return;
      }

      const data = payload?.data as QuickLookup;
      setLookup(data);
      setCurrentEan(data.ean);
      beep("success");
      setPhase("saved");
      setMessage(`Delt ${price.toFixed(2)} kr hos ${selectedStore.storeName}. Hopper tilbake til EAN-skanning...`);
      window.setTimeout(() => nextProduct(), 650);
    } catch (saveError) {
      beep("error");
      setPhase("error");
      setError(saveError instanceof Error ? saveError.message : "Kunne ikke lagre prisen.");
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
        detectorRef.current = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
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
          if (errorName !== "AbortError" && errorName !== "NotAllowedError") throw playError;
        }
      }

      if (cameraStartIdRef.current !== startId) return;
      setCameraReady(true);

      if (!window.BarcodeDetector) {
        setCameraError("Denne nettleseren støtter ikke strekkodeskanning direkte. Bruk en annen mobil/nettleser for skanning.");
      }
    } catch (cameraErrorValue) {
      if (cameraStartIdRef.current !== startId) return;
      const errorName = cameraErrorValue instanceof DOMException ? cameraErrorValue.name : "";
      if (errorName === "AbortError") return;
      setCameraReady(false);
      setCameraError(cameraErrorValue instanceof Error ? cameraErrorValue.message : "Fikk ikke startet kameraet.");
    }
  }

  useEffect(() => {
    loadStores().catch(() => undefined);
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    setLookup(null);
    setCurrentEan("");
    setManualPrice("");
    setError(null);
    setCameraPaused(false);
    setPhase(selectedStore ? "ready" : "idle");
    setMessage(selectedStore ? `Du er i ${selectedStore.storeName}. Skann en vare.` : "Velg butikk. Skann produkt. Oppdater pris hvis du vil.");
  }, [selectedStoreKey]);

  useEffect(() => {
    if (!lookup?.product || mobileMode !== "update_price") return;
    const focusTimer = window.setTimeout(() => {
      priceInputRef.current?.focus();
      priceInputRef.current?.select();
    }, 120);
    return () => window.clearTimeout(focusTimer);
  }, [lookup?.ean, lookup?.product, mobileMode]);


  useEffect(() => {
    startCamera().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!cameraReady) return;
    setCameraPaused(false);
  }, [cameraReady]);

  useEffect(() => {
    if (!cameraReady || lookup || !selectedStore) return;

    const timer = window.setTimeout(() => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
      setCameraPaused(true);
      setMessage("Kameraet er pauset etter 1 minutt. Trykk Skann neste for å fortsette.");
    }, 60_000);

    return () => window.clearTimeout(timer);
  }, [cameraReady, lookup, selectedStore]);

  useEffect(() => {
    if (!lookup) return;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, [lookup]);

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      if (cancelled) return;
      const video = videoRef.current;
      const detector = detectorRef.current;

      if (canScan && !lookup && !busy && cameraReady && video && detector && video.readyState >= 2 && !scanningRef.current) {
        scanningRef.current = true;
        try {
          const codes = await detector.detect(video);
          const ean = cleanEan(codes[0]?.rawValue ?? "");
          if (ean) await lookupEan(ean);
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
  }, [busy, cameraReady, canScan, selectedStoreKey, lookup]);

  function nextProduct() {
    setCameraPaused(false);
    setLookup(null);
    setCurrentEan("");
    setManualPrice("");
    setError(null);
    setBusy(false);
    setPhase(selectedStore ? "ready" : "idle");
    setMessage(selectedStore ? "Klar for neste vare." : "Velg butikk. Skann produkt. Oppdater pris hvis du vil.");
    lastScanRef.current = { ean: "", at: 0 };

    window.setTimeout(() => {
      startCamera().catch(() => undefined);
    }, 80);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-3 text-white">
      <div className="mx-auto max-w-xl space-y-3">
        {!lookup ? (
          <section className={`overflow-hidden rounded-[2rem] ring-1 ${selectedStore ? "bg-black ring-emerald-400/50" : "bg-slate-900 ring-white/10"}`}>
            <div className="relative aspect-[3/4] min-h-[520px] sm:aspect-[4/3] sm:min-h-0">
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

              <div className="absolute left-3 right-3 top-3 z-20 rounded-3xl bg-white p-3 text-slate-950 shadow-2xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label htmlFor="active-store" className="shrink-0 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                      Aktiv butikk
                    </label>
                    <p className="mt-1 text-sm font-bold text-slate-500">Velg butikk, skann produktet og del faktisk butikkpris.</p>
                  </div>
                  <Link href="/dashboard" className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
                    Dashboard
                  </Link>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {selectedStore ? <StoreLogoBadge storeKey={selectedStore.storeKey} storeName={selectedStore.storeName} /> : null}
                  <select
                    id="active-store"
                    value={selectedStoreKey}
                    onChange={(event) => setSelectedStoreKey(event.target.value)}
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-lg font-black outline-none focus:border-emerald-600"
                  >
                  <option value="">Velg butikk</option>
                  {activeStores.map((store) => (
                    <option key={store.storeKey} value={store.storeKey}>{store.storeName}</option>
                  ))}
                  </select>
                </div>
                {!activeStores.length ? (
                  <p className="mt-2 rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
                    Ingen aktive butikker funnet. Aktiver butikker i Admin først.
                  </p>
                ) : null}
              </div>

              <div className="pointer-events-none absolute inset-x-8 top-[56%] h-24 -translate-y-1/2 rounded-3xl border-4 border-emerald-300/80 shadow-[0_0_0_999px_rgba(2,6,23,0.34)]" />

              {!selectedStore ? (
                <div className="absolute inset-x-5 bottom-6 rounded-3xl bg-slate-950/80 p-4 text-center backdrop-blur">
                  <p className="text-lg font-black">Velg butikk i menyen over kameraet</p>
                  <p className="mt-1 text-sm font-bold text-slate-300">Når butikken er valgt, starter strekkodeskanning automatisk.</p>
                </div>
              ) : null}

              {cameraPaused && selectedStore ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/75 p-6 text-center">
                  <button type="button" onClick={nextProduct} className="rounded-3xl bg-emerald-300 px-6 py-5 text-xl font-black text-slate-950">
                    Skann neste
                  </button>
                </div>
              ) : null}

              {busy ? (
                <div className="absolute right-4 top-36 rounded-full bg-emerald-300 px-4 py-2 text-sm font-black text-slate-950 shadow-xl">
                  Henter pris...
                </div>
              ) : null}
            </div>

            <div className={`p-4 text-sm font-bold ${selectedStore ? "bg-emerald-300/15 text-emerald-100" : "bg-white/10 text-slate-200"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] opacity-75">{selectedStore?.storeName ?? "Klar når butikk er valgt"}</p>
                  <p className="mt-1 text-base font-black">{phaseTitle(phase)}</p>
                  {message ? <p className="mt-1 opacity-85">{message}</p> : null}
                  {cameraError ? <p className="mt-2 text-amber-200">{cameraError}</p> : null}
                </div>
                {cameraPaused && selectedStore ? (
                  <button type="button" onClick={nextProduct} className="shrink-0 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950">
                    Start
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {error ? <p className="rounded-3xl bg-rose-400/15 p-4 text-sm font-bold text-rose-100 ring-1 ring-rose-300/20">{error}</p> : null}

        {lookup ? (
          <div className="flex flex-col gap-3">
            <section className="rounded-[2rem] bg-white p-5 text-slate-950 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Aktiv butikk</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <StoreLogoBadge storeKey={selectedStore?.storeKey} storeName={selectedStore?.storeName} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href="/dashboard" className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700">
                    Dashboard
                  </Link>
                  <button type="button" onClick={nextProduct} className="rounded-3xl bg-slate-950 px-5 py-4 text-sm font-black text-white">
                    Neste
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 rounded-3xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setMobileMode("update_price")}
                  className={`rounded-2xl px-3 py-3 text-sm font-black ${mobileMode === "update_price" ? "bg-emerald-700 text-white shadow" : "text-slate-600"}`}
                >
                  Oppdater pris
                </button>
                <button
                  type="button"
                  onClick={() => setMobileMode("best_prices")}
                  className={`rounded-2xl px-3 py-3 text-sm font-black ${mobileMode === "best_prices" ? "bg-slate-950 text-white shadow" : "text-slate-600"}`}
                >
                  Beste kjøp nå
                </button>
              </div>
            </section>

            <section className={`rounded-[2rem] bg-white p-5 text-slate-950 shadow-xl ${mobileMode === "best_prices" ? "order-15" : "order-10"}`}>
              <div className="flex gap-4">
                {lookup.product?.imageUrl ? (
                  <img src={lookup.product.imageUrl} alt="" className="h-24 w-24 rounded-3xl object-contain" />
                ) : (
                  <div className="h-24 w-24 rounded-3xl bg-slate-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Vare skannet</p>
                  <h2 className="mt-2 text-[1.9rem] font-black leading-tight">{lookup.product?.name ?? lookup.ean}</h2>
                  <p className="mt-1 text-sm text-slate-500">{lookup.product?.brand ?? "Ukjent merke"} · EAN {lookup.ean}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lookup.isBasis ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Basisutvalg</span> : null}
                    {lookup.existsLocally && !lookup.isBasis ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Globalt produkt</span> : null}
                    {!lookup.existsLocally && lookup.product ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">Ikke lagret ennå</span> : null}
                  </div>
                </div>
              </div>
              {lookup.kassalappMessage ? <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{lookup.kassalappMessage}</p> : null}
            </section>

            {mobileMode !== "best_prices" ? (
              <section className="order-20 rounded-[2rem] bg-white p-5 text-slate-950 shadow-xl ring-2 ring-emerald-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Del butikkpris</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StoreLogoBadge storeKey={selectedStore?.storeKey} storeName={selectedStore?.storeName} />
                    </div>
                    {selectedStorePrice?.price ? (
                      <p className="mt-2 text-sm font-bold text-slate-500">
                        Sist kjent her: {kr(selectedStorePrice.price)} · {formatDate(selectedStorePrice.observedAt)}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm font-bold text-slate-500">Ingen kjent pris her. Skriv butikkprisen hvis du vil oppdatere fellesskapet.</p>
                    )}
                  </div>
                  {selectedStorePrice?.price ? <p className="text-3xl font-black text-emerald-700">{kr(selectedStorePrice.price)}</p> : null}
                </div>

                {productIsUnsaved ? (
                  <div className="mt-4 rounded-2xl bg-amber-50 p-3">
                    <p className="text-sm font-black text-amber-900">Varen finnes ikke i produktregisteret ennå.</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm font-black">
                      <button type="button" onClick={() => setSaveMode("basis")} className={`rounded-2xl px-3 py-3 ${saveMode === "basis" ? "bg-emerald-700 text-white" : "bg-white text-slate-700"}`}>Basis</button>
                      <button type="button" onClick={() => setSaveMode("global")} className={`rounded-2xl px-3 py-3 ${saveMode === "global" ? "bg-emerald-700 text-white" : "bg-white text-slate-700"}`}>Global</button>
                      <button type="button" onClick={() => setSaveMode("none")} className={`rounded-2xl px-3 py-3 ${saveMode === "none" ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}>Ikke lagre</button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 rounded-[1.5rem] border-2 border-emerald-100 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="manual-price" className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                      Ny pris
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setManualPrice("");
                        window.setTimeout(() => priceInputRef.current?.focus(), 0);
                      }}
                      className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-700"
                    >
                      Tøm
                    </button>
                  </div>
                  <input
                    ref={priceInputRef}
                    id="manual-price"
                    value={manualPrice}
                    onChange={(event) => setManualPrice(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const price = parsePrice(manualPrice);
                      if (!price) return;
                      event.preventDefault();
                      savePrice(price).catch(() => undefined);
                    }}
                    inputMode="decimal"
                    placeholder="f.eks. 29,90"
                    className="mt-3 w-full rounded-3xl border-2 border-slate-200 px-4 py-5 text-4xl font-black text-slate-950 outline-none focus:border-emerald-500"
                  />
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    Er butikkprisen lik sist kjent pris, trykk Del. Er den annerledes, skriv ny pris først.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => savePrice(parsePrice(manualPrice) ?? undefined)}
                  disabled={busy || !lookup.product || !parsePrice(manualPrice) || (productIsUnsaved && saveMode === "none")}
                  className="mt-4 w-full rounded-3xl bg-emerald-700 px-4 py-5 text-xl font-black text-white disabled:opacity-50"
                >
                  Del {parsePrice(manualPrice) ? kr(parsePrice(manualPrice)) : "pris"} hos {selectedStore?.storeName}
                </button>
                {productIsUnsaved && saveMode === "none" ? <p className="mt-3 text-sm font-semibold text-slate-500">Ikke lagre brukes bare for å se priser. Prisen kan ikke lagres uten produkt.</p> : null}
              </section>
            ) : null}

            <section className={`rounded-[2rem] bg-white p-5 text-slate-950 shadow-xl ${mobileMode === "best_prices" ? "order-20" : "order-50"}`}>
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleStorePrices.map((price) => (
                  <div key={price.storeKey} className={`rounded-[1.25rem] p-3 ${price.storeKey === selectedStoreKey ? "bg-emerald-50 ring-2 ring-emerald-300" : "bg-slate-50"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <StoreLogoBadge storeKey={price.storeKey} storeName={price.storeName} />
                        <p className="mt-2 text-xs font-semibold text-slate-500">{formatDate(price.observedAt)} · {price.source ?? "Ukjent kilde"}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-black text-emerald-700">{kr(price.price)}</p>
                        {price.unitPrice != null ? <p className="text-xs font-black text-slate-500">{kr(price.unitPrice)} / enhet</p> : null}
                      </div>
                    </div>
                  </div>
                ))}
                {visibleStorePrices.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-500">Ingen butikkpriser med gyldig pris er registrert ennå.</p>
                ) : null}
              </div>
            </section>

            {lookup.productGroup ? (
              <section className={`rounded-3xl bg-white p-4 text-slate-950 shadow-xl ${mobileMode === "best_prices" ? "order-20" : "order-40"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Anbefaling</p>
                    <h2 className="mt-1 text-2xl font-black">
                      {hasCheaperPackage ? "Kjøp heller billigere pakning" : "Beste kjøp nå"}
                    </h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {lookup.productGroup.name} · {lookup.productGroup.packageCount} forpakninger / EAN-varer
                    </p>
                  </div>
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-2xl font-black text-white">
                    ↗
                  </div>
                </div>

                {cheapestGroupPrice ? (
                  <div className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black">{cheapestGroupPrice.productName}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <StoreLogoBadge storeKey={cheapestGroupPrice.storeKey} storeName={cheapestGroupPrice.storeName} compact />
                          <p className="text-sm font-bold text-emerald-900/70">
                            {hasCheaperPackage && scannedGroupPrice
                              ? `${unitSavingsText(scannedGroupPrice, cheapestGroupPrice) ?? "Billigere per enhet"} enn skannet pakning`
                              : `${formatDate(cheapestGroupPrice.observedAt)}`}
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-200">Beste verdi</span>
                          <span className={`rounded-full px-3 py-1 text-xs font-black ${groupPriceFreshnessClass(cheapestGroupPrice)}`}>
                            {groupPriceFreshnessLabel(cheapestGroupPrice)}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-3xl font-black text-emerald-700">{kr(cheapestGroupPrice.unitPrice)}</p>
                        <p className="text-sm font-black text-emerald-900/70">
                          / {displayUnitSuffix(cheapestGroupPrice.comparisonUnit)}
                        </p>
                        <p className="mt-1 text-sm font-black text-slate-700">{kr(cheapestGroupPrice.price)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-600">
                    Ingen trygg nåpris funnet. Du kan fortsatt bruke produktet som basisvare, eller oppdatere prisen når du vil.
                  </p>
                )}

                {scannedGroupPrice ? (
                  <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
                    <p>
                      Skannet: {scannedGroupPrice.productName}
                      {scannedGroupPrice.unitPrice != null ? (
                        <> · {kr(scannedGroupPrice.unitPrice)} / {displayUnitSuffix(scannedGroupPrice.comparisonUnit)}</>
                      ) : null}
                    </p>
                    {hasCheaperPackage ? (
                      <p className="mt-1 text-emerald-800">
                        Billigere pakning finnes: {cheapestGroupPrice?.productName}
                        {unitSavingsText(scannedGroupPrice, cheapestGroupPrice) ? ` · ${unitSavingsText(scannedGroupPrice, cheapestGroupPrice)}` : ""}.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Gyldige priser</p>
                  {validGroupPrices.length ? (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-100">
                      {validGroupPrices.map((option, index) => {
                        const isBest = cheapestGroupPrice
                          ? option.productId === cheapestGroupPrice.productId && option.storeKey === cheapestGroupPrice.storeKey && option.observedAt === cheapestGroupPrice.observedAt
                          : index === 0;
                        const isScanned = scannedGroupPrice ? option.productId === scannedGroupPrice.productId : false;
                        return (
                          <div
                            key={`${option.productId}:${option.storeKey}:${option.observedAt ?? index}`}
                            className={`grid grid-cols-[0.8fr_1.25fr_0.8fr_0.9fr] items-center gap-2 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 ${isBest ? "bg-emerald-50" : isScanned ? "bg-blue-50" : "bg-white"}`}
                          >
                            <div className="min-w-0">
                              <StoreLogoBadge storeKey={option.storeKey} storeName={option.storeName} compact />
                              <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{groupPriceAgeText(option)}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-black">{option.packageSize ?? option.productName}</p>
                              <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{option.productName}</p>
                            </div>
                            <p className="text-right font-black">{kr(option.price)}</p>
                            <div className="text-right">
                              <p className={`font-black ${isBest ? "text-emerald-700" : isScanned ? "text-blue-700" : "text-slate-950"}`}>
                                {kr(option.unitPrice)} / {displayUnitSuffix(option.comparisonUnit)}
                              </p>
                              {isBest ? <span className="mt-1 inline-flex rounded-full bg-emerald-700 px-2 py-1 text-[10px] font-black text-white">Best pris</span> : null}
                              {isScanned && !isBest ? <span className="mt-1 inline-flex rounded-full bg-blue-600 px-2 py-1 text-[10px] font-black text-white">Skannet</span> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-500">Ingen gyldige sammenligningspriser ennå.</p>
                  )}
                </div>

                {validGroupPrices.length ? (
                  <div className="mt-4 rounded-3xl bg-slate-50 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Billigere pakningsstørrelser</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {validGroupPrices.slice(0, 3).map((option, index) => {
                        const isBest = index === 0;
                        return (
                          <div key={`chip:${option.productId}:${option.storeKey}:${option.observedAt ?? index}`} className={`rounded-2xl p-3 ${isBest ? "bg-white ring-2 ring-emerald-400" : "bg-white ring-1 ring-slate-200"}`}>
                            <p className="truncate text-xs font-black text-slate-600">{option.packageSize ?? option.productName}</p>
                            <p className={`mt-1 text-base font-black ${isBest ? "text-emerald-700" : "text-slate-950"}`}>{kr(option.unitPrice)}</p>
                            <p className="text-[11px] font-bold text-slate-500">/ {displayUnitSuffix(option.comparisonUnit)}</p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm font-semibold text-blue-900">
                      Viser bare nyeste aktuelle pris per butikk. Grønt er 0–30 dager, gult er 31–45 dager.
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}

            <button type="button" onClick={nextProduct} className="sticky bottom-4 z-20 order-[100] w-full rounded-3xl bg-white px-5 py-5 text-xl font-black text-slate-950 shadow-xl shadow-black/30">
              Skann neste
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
