"use client";

import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { kr, unitPriceLabel } from "@/lib/utils";

type Product = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  target_price: number | null;
  target_price_unit: string | null;
  desired_stock: number | null;
  is_basis: boolean | null;
  is_freezable: boolean | null;
  preferred_store: string | null;
  notes: string | null;
  description?: string | null;
  ingredients?: string | null;
  allergens?: unknown | null;
  nutrition?: unknown | null;
  labels?: unknown | null;
  category_path?: string[] | null;
};

type InventoryItem = {
  id: string;
  location: string;
  quantity: number;
  desired_quantity: number;
  expires_at: string | null;
  updated_at: string | null;
};

type Observation = {
  id: string;
  store_code: string;
  store_name: string;
  price: number;
  unit_price: number | null;
  comparison_unit: string | null;
  package_quantity?: number | null;
  package_unit?: string | null;
  observed_at: string;
  source: string | null;
  source_url: string | null;
};

type DetailPayload = {
  product: Product;
  inventory: InventoryItem[];
  price_observations: Observation[];
  latest_by_store: Array<{
    store_name: string;
    price: number;
    unit_price: number | null;
    comparison_unit: string | null;
    observed_at: string;
    source: string | null;
    source_url: string | null;
  }>;
};

function shortDate(value?: string | null) {
  return value ? value.slice(0, 10) : "-";
}

function shortDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace("T", " ");
  return new Intl.DateTimeFormat("nb-NO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function ageDays(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function freshnessLabel(value?: string | null) {
  const age = ageDays(value);
  if (age === null) return "Ukjent alder";
  if (age === 0) return "Aktuell pris · i dag";
  if (age <= 30) return `Aktuell pris · ${age} dager`;
  if (age <= 45) return `Bør sjekkes · ${age} dager`;
  return `Ikke nåpris · ${age} dager`;
}

function freshnessClass(value?: string | null) {
  const age = ageDays(value);
  if (age === null || age > 45) return "bg-slate-100 text-slate-600";
  if (age <= 30) return "bg-emerald-50 text-emerald-700";
  return "bg-amber-50 text-amber-800";
}

function priceSourceLabel(source?: string | null) {
  const normalized = String(source ?? "").trim().toLowerCase();

  if (!normalized) return "Ukjent kilde";
  if (normalized.includes("receipt")) return "Kvittering";
  if (normalized.includes("shelf")) return "Skannet pris";
  if (normalized.includes("manual")) return "Manuelt";
  if (normalized.includes("kassalapp")) return "Kassalapp API";
  if (normalized.includes("mobile-scan")) return "Kassalapp API";

  return source ?? "Ukjent kilde";
}

function toFormValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function packageLabel(product: Product | null | undefined, observation?: Observation | null) {
  const raw = String(product?.package_size ?? "").trim();
  const name = String(product?.name ?? "").toLowerCase();
  const normalized = raw.replace(",", ".");

  const amountCount = name.match(/(\d+(?:[,.]\d+)?)\s*(l|liter|ml|g|kg)\s*x\s*(\d+)/i) ?? name.match(/(\d+(?:[,.]\d+)?)(l|ml|g|kg)x(\d+)/i);
  if (amountCount) {
    const amount = Number(amountCount[1].replace(",", "."));
    const unit = amountCount[2].toLowerCase().startsWith("liter") ? "l" : amountCount[2].toLowerCase();
    const count = Number(amountCount[3]);
    if (Number.isFinite(amount) && Number.isFinite(count)) {
      if (unit === "ml") return `${amount} ml x ${count} = ${amount * count} ml`;
      if (unit === "g") {
        const totalKg = (amount * count) / 1000;
        return `${amount} g x ${count} = ${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(totalKg)} kg`;
      }
      return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(amount)} ${unit} x ${count} = ${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(amount * count)} ${unit}`;
    }
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (observation?.comparison_unit === "l") {
      return numeric >= 100 ? `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(numeric / 1000)} l` : `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(numeric)} l`;
    }
    if (observation?.comparison_unit === "kg") {
      return numeric >= 100 ? `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(numeric / 1000)} kg` : `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(numeric)} kg`;
    }
  }

  return raw || "Mangler";
}

function issueList(product: Product, latest: Observation | null) {
  const issues: string[] = [];
  if (!product.ean) issues.push("EAN mangler");
  if (!product.package_size) issues.push("Pakningsstørrelse mangler");
  if (!product.category) issues.push("Kategori mangler");
  if (latest && latest.unit_price === null) issues.push("Siste pris mangler enhetspris");
  if (!product.is_basis) issues.push("Ikke med i basisvarer");
  return issues;
}

export default function ProductRulesPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const [data, setData] = useState<DetailPayload | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const response = await authFetch(`/api/products/${productId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente produkt");
      return;
    }
    const detail = payload.data as DetailPayload;
    setData(detail);
    setForm({
      name: toFormValue(detail.product.name),
      brand: toFormValue(detail.product.brand),
      category: toFormValue(detail.product.category),
      package_size: toFormValue(detail.product.package_size),
      target_price: toFormValue(detail.product.target_price),
      target_price_unit: detail.product.target_price_unit ?? "unit",
      desired_stock: toFormValue(detail.product.desired_stock),
      is_basis: Boolean(detail.product.is_basis),
      is_freezable: Boolean(detail.product.is_freezable),
      preferred_store: toFormValue(detail.product.preferred_store),
      notes: toFormValue(detail.product.notes)
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const response = await authFetch(`/api/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke lagre produktdata");
      return;
    }
    setMessage("Produktet er oppdatert.");
    await load();
  }

  async function syncProduct() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    const response = await authFetch(`/api/products/${productId}/sync`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    setSyncing(false);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke synke produkt");
      return;
    }
    setMessage(`Synket ${payload.inserted ?? 0} prisobservasjoner for produktet.`);
    await load();
  }

  async function editPriceObservation(observation: Observation) {
    const priceText = window.prompt("Ny pris", String(observation.price).replace(".", ","));
    if (priceText === null) return;

    const price = Number(priceText.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) {
      setError("Pris må være større enn 0.");
      return;
    }

    const storeName = window.prompt("Butikk", observation.store_name);
    if (storeName === null) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const response = await authFetch(`/api/products/${productId}/prices/${observation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        price,
        unit_price: observation.unit_price,
        store_name: storeName
      })
    });

    const payload = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke endre pris");
      return;
    }

    setMessage("Prisobservasjonen er oppdatert.");
    await load();
  }

  async function deletePriceObservation(observation: Observation) {
    const ok = window.confirm(`Slette pris fra ${observation.store_name} (${kr(observation.price)})?`);
    if (!ok) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const response = await authFetch(`/api/products/${productId}/prices/${observation.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke slette pris");
      return;
    }

    setMessage("Prisobservasjonen er slettet.");
    await load();
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [productId]);

  const latest = data?.price_observations?.[0] ?? null;
  const currentPrices = useMemo(() => (data?.price_observations ?? []).filter((item) => {
    const age = ageDays(item.observed_at);
    return age !== null && age <= 45;
  }), [data?.price_observations]);
  const bestCurrentPrice = useMemo(() => [...currentPrices].filter((item) => item.unit_price !== null).sort((a, b) => Number(a.unit_price ?? Infinity) - Number(b.unit_price ?? Infinity))[0] ?? null, [currentPrices]);
  const stockTotal = useMemo(() => data?.inventory.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0) ?? 0, [data]);
  const desiredTotal = useMemo(() => {
    const desiredValues = data?.inventory.map((item) => Number(item.desired_quantity ?? 0)) ?? [];
    const desiredFromInventory = Math.max(0, ...desiredValues);
    return desiredFromInventory || Number(data?.product.desired_stock ?? 0);
  }, [data]);
  const issues = data ? issueList(data.product, latest) : [];

  return (
    <AppShell active="Basisvarer">
      <div className="mx-auto max-w-6xl space-y-4 pb-24 md:space-y-6 md:pb-10">
        <div className="flex items-center justify-between gap-3">
          <Link href="/products" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-brand shadow-sm ring-1 ring-line">
            ← Produkter
          </Link>
          <div className="flex items-center gap-2">
            <Link href={`/products/${productId}/assessment`} className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-brand md:inline-flex">
              AI-vurdering
            </Link>
            <button onClick={save} disabled={saving || loading} className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-white disabled:opacity-60">
              {saving ? "Lagrer..." : "Lagre"}
            </button>
          </div>
        </div>

        {message ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-brand">{message}</p> : null}
        {error ? <p className="rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}
        {loading ? <div className="card p-10 text-center text-muted">Henter produkt...</div> : null}

        {data ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_360px] md:items-start md:gap-6">
            <main className="space-y-4 md:space-y-6">
              <section className="card overflow-hidden p-0">
                <div className="grid grid-cols-[96px_1fr] gap-4 p-4 md:grid-cols-[150px_1fr] md:gap-6 md:p-6">
                  <div className="grid h-24 w-24 place-items-center rounded-3xl bg-white p-2 ring-1 ring-line md:h-36 md:w-36">
                    {data.product.image_url ? (
                      <img src={data.product.image_url} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                    ) : (
                      <span className="text-4xl md:text-6xl">🛒</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Forpakning / EAN-vare</p>
                    <h1 className="mt-2 text-2xl font-black leading-tight text-slate-950 md:text-4xl">{data.product.name}</h1>
                    <p className="mt-2 text-sm font-semibold text-muted">{data.product.brand ?? "Ukjent merke"} · EAN {data.product.ean ?? "mangler"}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{packageLabel(data.product, latest)}</span>
                      {data.product.category ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{data.product.category}</span> : null}
                      {data.product.is_basis ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-brand">Basisvare</span> : <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">Ikke basis</span>}
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 md:p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Pris nå</p>
                  <p className="mt-3 text-3xl font-black text-slate-950 md:text-4xl">{kr(latest?.price ?? null)}</p>
                  <p className="mt-1 text-xs font-bold text-slate-600">{latest ? `${latest.store_name} · ${priceSourceLabel(latest.source)}` : "Ingen pris"}</p>
                </div>
                <div className="rounded-3xl border border-violet-100 bg-violet-50 p-4 md:p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Enhetspris</p>
                  <p className="mt-3 break-words text-3xl font-black text-slate-950 md:text-4xl">{unitPriceLabel(latest?.unit_price ?? null, latest?.comparison_unit ?? null)}</p>
                  <p className="mt-1 text-xs font-bold text-slate-600">{packageLabel(data.product, latest)}</p>
                </div>
                <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 md:p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">Målpris</p>
                  <p className="mt-3 text-3xl font-black text-slate-950 md:text-4xl">{kr(data.product.target_price)}</p>
                  <p className="mt-1 text-xs font-bold text-slate-600">{data.product.target_price_unit === "unit_price" ? "Per kg/l/enhet" : "Per pakke"}</p>
                </div>
                <div className={`rounded-3xl border p-4 md:p-5 ${stockTotal < desiredTotal ? "border-rose-100 bg-rose-50" : "border-emerald-100 bg-emerald-50"}`}>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-700">Lager</p>
                  <p className="mt-3 text-3xl font-black text-slate-950 md:text-4xl">{stockTotal} / {desiredTotal}</p>
                  <p className="mt-1 text-xs font-bold text-slate-600">Faktisk / ønsket</p>
                </div>
              </section>

              <section className="card p-4 md:p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Neste handling</p>
                    <h2 className="mt-1 text-2xl font-black">Oppdater pris eller rett data</h2>
                    <p className="mt-1 text-sm text-muted">Mobil først: gjør det viktigste raskt, uten å åpne store skjema.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
                    <button type="button" onClick={() => latest ? editPriceObservation(latest) : setError("Ingen prisobservasjon å oppdatere ennå. Skann eller legg inn pris fra mobilskann.")} className="rounded-2xl bg-brand px-4 py-3 text-sm font-black text-white">
                      Oppdater pris
                    </button>
                    <a href="#produktdata" className="rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">
                      Rett produktdata
                    </a>
                  </div>
                </div>
              </section>

              <section className="card p-4 md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Beste kjøp nå</p>
                    <h2 className="mt-1 text-2xl font-black">Beste pris for denne forpakningen</h2>
                    <p className="mt-1 text-sm text-muted">Bare nåpriser brukes: grønn 0–30 dager, gul 31–45 dager.</p>
                  </div>
                  {bestCurrentPrice ? <span className={`hidden rounded-full px-3 py-1 text-xs font-black md:inline-flex ${freshnessClass(bestCurrentPrice.observed_at)}`}>{freshnessLabel(bestCurrentPrice.observed_at)}</span> : null}
                </div>
                {bestCurrentPrice ? (
                  <div className="mt-4 rounded-3xl bg-emerald-50 p-4">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold text-slate-600">{bestCurrentPrice.store_name} · {priceSourceLabel(bestCurrentPrice.source)}</p>
                        <p className="mt-1 text-4xl font-black text-brand">{unitPriceLabel(bestCurrentPrice.unit_price, bestCurrentPrice.comparison_unit)}</p>
                        <p className="mt-1 text-sm font-bold text-slate-700">{kr(bestCurrentPrice.price)} · {packageLabel(data.product, bestCurrentPrice)}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${freshnessClass(bestCurrentPrice.observed_at)}`}>{freshnessLabel(bestCurrentPrice.observed_at)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-800">Ingen trygg nåpris. Du kan fortsatt ha varen som basisvare og oppdatere pris når du vil.</p>
                )}
              </section>

              <section id="produktdata" className="card p-0">
                <details open className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between p-4 md:p-6">
                    <div>
                      <h2 className="text-xl font-black">Produktdata</h2>
                      <p className="mt-1 text-sm text-muted">Rett navn, kategori og pakning når produktet er feil.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700 group-open:hidden">Åpne</span>
                    <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700 group-open:inline-flex">Lukk</span>
                  </summary>
                  <div className="grid gap-4 border-t border-line p-4 md:grid-cols-2 md:p-6">
                    <label className="space-y-1 text-sm"><span className="font-bold">Produktnavn</span><input className="w-full rounded-xl border border-line px-3 py-3" value={String(form.name ?? "")} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                    <label className="space-y-1 text-sm"><span className="font-bold">Merke</span><input className="w-full rounded-xl border border-line px-3 py-3" value={String(form.brand ?? "")} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label>
                    <label className="space-y-1 text-sm"><span className="font-bold">Kategori</span><input className="w-full rounded-xl border border-line px-3 py-3" placeholder="Brus, Pasta, Ketchup..." value={String(form.category ?? "")} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
                    <label className="space-y-1 text-sm"><span className="font-bold">Pakningsstørrelse</span><input className="w-full rounded-xl border border-line px-3 py-3" placeholder="1500 ml, 500 g, 9000 ml" value={String(form.package_size ?? "")} onChange={(e) => setForm({ ...form, package_size: e.target.value })} /><span className="text-xs text-muted">Viktig for riktig kr/kg eller kr/l.</span></label>
                    <label className="space-y-1 text-sm"><span className="font-bold">EAN</span><input className="w-full rounded-xl border border-line bg-slate-50 px-3 py-3 text-muted" value={data.product.ean ?? ""} readOnly /></label>
                    <label className="space-y-1 text-sm"><span className="font-bold">Foretrukket butikk</span><input className="w-full rounded-xl border border-line px-3 py-3" placeholder="KIWI, MENY..." value={String(form.preferred_store ?? "")} onChange={(e) => setForm({ ...form, preferred_store: e.target.value })} /></label>
                  </div>
                </details>
              </section>

              <section className="card p-0">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between p-4 md:p-6">
                    <div>
                      <h2 className="text-xl font-black">Basisregler</h2>
                      <p className="mt-1 text-sm text-muted">Målpris, lager og husholdningsregler.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700 group-open:hidden">Åpne</span>
                    <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700 group-open:inline-flex">Lukk</span>
                  </summary>
                  <div className="grid gap-4 border-t border-line p-4 md:grid-cols-2 md:p-6">
                    <label className="space-y-1 text-sm"><span className="font-bold">Målpris</span><input type="number" step="0.01" className="w-full rounded-xl border border-line px-3 py-3" value={String(form.target_price ?? "")} onChange={(e) => setForm({ ...form, target_price: e.target.value })} /></label>
                    <label className="space-y-1 text-sm"><span className="font-bold">Målpris-type</span><select className="w-full rounded-xl border border-line px-3 py-3" value={String(form.target_price_unit ?? "unit")} onChange={(e) => setForm({ ...form, target_price_unit: e.target.value })}><option value="unit">Per stk/pakke</option><option value="unit_price">Per kg/l/enhet</option></select></label>
                    <label className="space-y-1 text-sm"><span className="font-bold">Ønsket lager</span><input type="number" step="1" className="w-full rounded-xl border border-line px-3 py-3" value={String(form.desired_stock ?? "")} onChange={(e) => setForm({ ...form, desired_stock: e.target.value })} /></label>
                    <label className="flex items-center gap-3 rounded-xl border border-line px-3 py-3 text-sm font-bold"><input type="checkbox" checked={Boolean(form.is_basis)} onChange={(e) => setForm({ ...form, is_basis: e.target.checked })} /> Med i basisvarer</label>
                    <label className="flex items-center gap-3 rounded-xl border border-line px-3 py-3 text-sm font-bold"><input type="checkbox" checked={Boolean(form.is_freezable)} onChange={(e) => setForm({ ...form, is_freezable: e.target.checked })} /> Kan fryses</label>
                    <label className="space-y-1 text-sm md:col-span-2"><span className="font-bold">Notat / regel</span><textarea className="min-h-24 w-full rounded-xl border border-line px-3 py-3" value={String(form.notes ?? "")} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Eksempel: Kjøp når pris er under målpris og lager <= 1." /></label>
                  </div>
                </details>
              </section>

              <section className="card p-0">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between p-4 md:p-6">
                    <div>
                      <h2 className="text-xl font-black">Prisvedlikehold</h2>
                      <p className="mt-1 text-sm text-muted">Bruk bare ved feil pris. Historikk vises ikke som beslutningsgrunnlag.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700 group-open:hidden">Åpne</span>
                    <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700 group-open:inline-flex">Lukk</span>
                  </summary>
                  <div className="space-y-2 border-t border-line p-4 md:p-6">
                    {data.price_observations.slice(0, 8).map((item) => (
                      <div key={item.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-black">{item.store_name}</p>
                            <p className="mt-1 text-xs text-muted">{shortDateTime(item.observed_at)} · {priceSourceLabel(item.source)}</p>
                            <p className="mt-1 text-xs text-muted">Pakning: {packageLabel(data.product, item)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-black text-brand">{kr(item.price)}</p>
                            <p className="text-sm font-bold text-muted">{unitPriceLabel(item.unit_price, item.comparison_unit)}</p>
                            <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-black ${freshnessClass(item.observed_at)}`}>{freshnessLabel(item.observed_at)}</span>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => editPriceObservation(item)} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-slate-700">Endre</button>
                          <button type="button" onClick={() => deletePriceObservation(item)} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700">Slett</button>
                        </div>
                      </div>
                    ))}
                    {!data.price_observations.length ? <p className="text-sm text-muted">Ingen prisobservasjoner ennå.</p> : null}
                  </div>
                </details>
              </section>
            </main>

            <aside className="space-y-4 md:sticky md:top-6">
              <section className="card p-4 md:p-5">
                <h2 className="text-lg font-black">Må sjekkes</h2>
                {issues.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {issues.map((issue) => <span key={issue} className="rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-800">{issue}</span>)}
                  </div>
                ) : <p className="mt-2 text-sm text-muted">Ingen åpenbare datamangler.</p>}
              </section>

              <section className="card p-4 md:p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-black">Lagerlinjer</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">{stockTotal} / {desiredTotal}</span>
                </div>
                <div className="mt-4 space-y-2">
                  {data.inventory.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
                      <div className="flex justify-between"><span className="font-bold">{item.location}</span><span>{item.quantity} / {item.desired_quantity}</span></div>
                      <p className="mt-1 text-xs text-muted">Oppdatert {shortDate(item.updated_at)}</p>
                    </div>
                  ))}
                  {!data.inventory.length ? <p className="text-sm text-muted">Ingen lagerlinje ennå.</p> : null}
                </div>
              </section>

              <section className="card p-4 md:p-5">
                <h2 className="text-lg font-black">Admin</h2>
                <div className="mt-3 grid gap-2">
                  <Link href={`/products/${productId}/assessment`} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-black text-brand">AI-vurdering</Link>
                  <button onClick={syncProduct} disabled={syncing || loading} className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-black text-slate-700 disabled:opacity-60">
                    {syncing ? "Synker..." : "Synk priser"}
                  </button>
                </div>
              </section>
            </aside>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
