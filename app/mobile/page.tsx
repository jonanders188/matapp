"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

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

type QuickLookup = {
  ean: string;
  product: QuickProduct | null;
  existsLocally: boolean;
  isBasis: boolean;
  prices: QuickPrice[];
  kassalappMessage: string | null;
  savedPrice?: {
    price: number;
    storeKey: string;
    storeName: string;
    observedAt: string;
  };
};

type SaveMode = "none" | "global" | "basis";
type ScanPhase = "idle" | "ready" | "scanned" | "loading" | "found" | "not_found" | "saving" | "saved" | "error";

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

function parsePrice(value: string) {
  const number = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
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
  if (phase === "loading") return "Henter vare og priser";
  if (phase === "found") return "Vare funnet";
  if (phase === "not_found") return "Vare ikke funnet";
  if (phase === "saving") return "Lagrer pris";
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
  const [message, setMessage] = useState("Velg butikk før du starter skanning.");
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentEan, setCurrentEan] = useState("");
  const [lookup, setLookup] = useState<QuickLookup | null>(null);
  const [manualPrice, setManualPrice] = useState("");
  const [saveMode, setSaveMode] = useState<SaveMode>("basis");

  const activeStores = useMemo(() => stores.filter((store) => store.isEnabled !== false), [stores]);
  const selectedStore = activeStores.find((store) => store.storeKey === selectedStoreKey) ?? null;
  const selectedStorePrice = lookup?.prices.find((price) => price.storeKey === selectedStoreKey) ?? null;
  const canScan = Boolean(selectedStore);
  const productIsUnsaved = Boolean(lookup?.product && !lookup.existsLocally);
  const hasResult = Boolean(lookup);

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
    setMessage(`EAN ${ean} lest. Henter vare og priser...`);
    window.setTimeout(() => setPhase("loading"), 120);

    try {
      const response = await authFetch(`/api/mobile/quick-price?ean=${encodeURIComponent(ean)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        beep("error");
        setPhase("error");
        setError(payload?.error ?? "Kunne ikke hente varen.");
        return;
      }

      const data = payload?.data as QuickLookup;
      setLookup(data);
      setSaveMode(data.existsLocally ? "none" : "basis");
      if (data.product) {
        beep("success");
        setPhase("found");
      } else {
        beep("error");
        setPhase("not_found");
      }
      setMessage(data.product ? `${data.product.name} er hentet og klar.` : data.kassalappMessage ?? "Fant ikke varen.");
    } catch (lookupError) {
      beep("error");
      setPhase("error");
      setError(lookupError instanceof Error ? lookupError.message : "Kunne ikke hente varen.");
    } finally {
      setBusy(false);
    }
  }

  async function savePrice() {
    if (!selectedStore) {
      setError("Velg butikk før du lagrer pris.");
      return;
    }

    const ean = cleanEan(currentEan || lookup?.ean || "");
    const price = parsePrice(manualPrice);

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
    setMessage(`Lagrer ${price.toFixed(2)} kr hos ${selectedStore.storeName}...`);

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
      setManualPrice("");
      beep("success");
      setPhase("saved");
      setMessage(`Lagret ${price.toFixed(2)} kr hos ${selectedStore.storeName}. Klar for neste vare.`);
    } catch (saveError) {
      beep("error");
      setPhase("error");
      setError(saveError instanceof Error ? saveError.message : "Kunne ikke lagre prisen.");
    } finally {
      setBusy(false);
    }
  }

  function resetForNextProduct() {
    lastScanRef.current = { ean: "", at: 0 };
    setLookup(null);
    setCurrentEan("");
    setManualPrice("");
    setError(null);
    setMessage(selectedStore ? "Klar. Skann neste vare." : "Velg butikk før du starter skanning.");
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
    setPhase(selectedStore ? "ready" : "idle");
    setMessage(selectedStore ? `Du er i ${selectedStore.storeName}. Skann en vare.` : "Velg butikk før du starter skanning.");
  }, [selectedStoreKey]);

  useEffect(() => {
    startCamera().catch(() => undefined);
  }, []);

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
    setLookup(null);
    setCurrentEan("");
    setManualPrice("");
    setError(null);
    setBusy(false);
    setPhase(selectedStore ? "ready" : "idle");
    setMessage(selectedStore ? "Klar for neste vare." : "Velg butikk før du starter skanning.");
    lastScanRef.current = { ean: "", at: 0 };

    window.setTimeout(() => {
      startCamera().catch(() => undefined);
    }, 80);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-white">
      <div className="mx-auto max-w-xl space-y-4">
        {!selectedStore ? (
          <header className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/10">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-emerald-200">Mobil prisapp</p>
            <h1 className="mt-2 text-2xl font-black">Velg butikk</h1>
            <p className="mt-2 text-sm text-slate-300">Butikk velges én gang når appen åpnes. Etterpå er skjermen optimalisert for én hånd.</p>
          </header>
        ) : (
          <header className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">Mobil prisapp</p>
              <p className="text-sm font-black text-white">{phaseTitle(phase)}</p>
            </div>
            <span className="rounded-full bg-emerald-300 px-3 py-1 text-xs font-black text-slate-950">{selectedStore.storeName}</span>
          </header>
        )}

        <section className={`rounded-3xl p-4 text-sm font-bold ring-1 ${phaseTone(phase)}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] opacity-80">Status</p>
              <p className="mt-1 text-lg font-black">{phaseTitle(phase)}</p>
              {message ? <p className="mt-1 opacity-90">{message}</p> : null}
            </div>
            {lookup ? (
              <button type="button" onClick={nextProduct} className="shrink-0 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950">
                Neste vare
              </button>
            ) : null}
          </div>
        </section>

        {!lookup && !selectedStore ? (
        <section className="rounded-3xl bg-white p-4 text-slate-950 shadow-xl">
          <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Jeg er i butikk</label>
          <select
            value={selectedStoreKey}
            onChange={(event) => setSelectedStoreKey(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-lg font-black outline-none focus:border-emerald-600"
          >
            <option value="">Velg aktiv butikk før skanning</option>
            {activeStores.map((store) => (
              <option key={store.storeKey} value={store.storeKey}>{store.storeName}</option>
            ))}
          </select>
          {!activeStores.length ? <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">Ingen aktive butikker funnet. Aktiver butikker i Admin først.</p> : null}
        </section>
        ) : null}

        {!lookup ? (
        <section className={`overflow-hidden rounded-3xl ring-1 ${selectedStore ? "bg-black ring-emerald-400/40" : "bg-slate-900 ring-amber-300/40 opacity-70"}`}>
          <div className="relative aspect-[4/3]">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-3xl border-4 border-emerald-300/80 shadow-[0_0_0_999px_rgba(2,6,23,0.35)]" />
            {!selectedStore ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 p-6 text-center">
                <p className="rounded-3xl bg-amber-300 px-5 py-4 text-lg font-black text-slate-950">Velg butikk først</p>
              </div>
            ) : null}
            {busy ? <div className="absolute right-4 top-4 rounded-full bg-emerald-300 px-4 py-2 text-sm font-black text-slate-950">Jobber...</div> : null}
          </div>
          <div className="bg-slate-900 p-4">
            <p className="font-bold">{cameraReady ? selectedStore ? "Klar" : "Velg butikk" : "Starter kamera..."}</p>
            {cameraError ? <p className="mt-1 text-sm text-amber-200">{cameraError}</p> : null}
          </div>
        </section>
        ) : null}

        {error ? <p className="rounded-3xl bg-rose-400/15 p-4 text-sm font-bold text-rose-100 ring-1 ring-rose-300/20">{error}</p> : null}

        {lookup ? (
          <>
            <section className="rounded-3xl bg-white p-4 text-slate-950 shadow-xl">
              <div className="flex gap-4">
                {lookup.product?.imageUrl ? (
                  <img src={lookup.product.imageUrl} alt="" className="h-24 w-24 rounded-2xl object-cover" />
                ) : (
                  <div className="h-24 w-24 rounded-2xl bg-slate-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{sourceBadge(lookup.product)}</p>
                  <h2 className="mt-1 text-xl font-black">{lookup.product?.name ?? lookup.ean}</h2>
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

            <section className="rounded-3xl bg-white p-4 text-slate-950 shadow-xl">
              <h2 className="text-lg font-black">Priser siste 14 dager</h2>
              <div className="mt-3 space-y-2">
                {lookup.prices.map((price) => (
                  <div key={price.storeKey} className={`rounded-2xl p-3 ${price.storeKey === selectedStoreKey ? "bg-emerald-50 ring-2 ring-emerald-300" : "bg-slate-50"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black">{price.storeName}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{price.price != null ? `${formatDate(price.observedAt)} · ${price.source ?? "Ukjent kilde"}` : "Ingen gyldig 14-dagers pris"}</p>
                      </div>
                      <p className="text-lg font-black text-emerald-700">{kr(price.price)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl bg-white p-4 text-slate-950 shadow-xl">
              <h2 className="text-lg font-black">Legg inn pris i {selectedStore?.storeName}</h2>
              {selectedStorePrice?.price ? <p className="mt-1 text-sm text-slate-500">Sist kjent her: {kr(selectedStorePrice.price)} · {formatDate(selectedStorePrice.observedAt)}</p> : null}

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

              <div className="mt-4 flex gap-2">
                <input
                  value={manualPrice}
                  onChange={(event) => setManualPrice(event.target.value)}
                  inputMode="decimal"
                  placeholder="Pris nå"
                  className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-4 py-4 text-xl font-black outline-none focus:border-emerald-600"
                />
                <button type="button" onClick={savePrice} disabled={busy || !lookup.product || (productIsUnsaved && saveMode === "none")} className="rounded-2xl bg-emerald-700 px-4 py-4 font-black text-white disabled:opacity-50">
                  Lagre
                </button>
              </div>
              {productIsUnsaved && saveMode === "none" ? <p className="mt-3 text-sm font-semibold text-slate-500">Ikke lagre brukes bare for å se Kassalapp-priser. Prisen kan ikke lagres uten produkt.</p> : null}
            </section>

            <button type="button" onClick={nextProduct} className="sticky bottom-4 z-20 w-full rounded-3xl bg-white px-5 py-5 text-xl font-black text-slate-950 shadow-xl shadow-black/30">
              Skann neste vare
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
