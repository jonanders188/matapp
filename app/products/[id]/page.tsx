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
  if (normalized.includes("shelf")) return "Hyllekant";
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/products" className="text-sm font-semibold text-brand">← Tilbake til produkter</Link>
          <h1 className="mt-3 text-3xl font-bold">Produktvedlikehold</h1>
          <p className="mt-1 max-w-3xl text-muted">Rett produktdata, pakning og prisgrunnlag. Siden er laget for nåsituasjon og feilretting, ikke historikk.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/products/${productId}/assessment`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-brand hover:bg-emerald-100">
            AI-vurdering
          </Link>
          <button onClick={syncProduct} disabled={syncing || loading} className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">
            {syncing ? "Synker..." : "Synk priser"}
          </button>
          <button onClick={save} disabled={saving || loading} className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Lagrer..." : "Lagre endringer"}
          </button>
        </div>
      </div>

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-brand">{message}</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {loading ? <div className="card mt-6 p-10 text-center text-muted">Henter produkt...</div> : null}

      {data ? (
        <div className="mt-6 grid grid-cols-[360px_1fr] gap-6">
          <aside className="space-y-5">
            <section className="card overflow-hidden p-0">
              <div className="grid h-64 place-items-center bg-white p-5">
                {data.product.image_url ? <img src={data.product.image_url} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <span className="text-6xl">🛒</span>}
              </div>
              <div className="border-t border-line p-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Forpakning / EAN-vare</p>
                <h2 className="mt-2 text-2xl font-bold leading-tight">{data.product.name}</h2>
                <p className="mt-2 text-sm text-muted">{data.product.brand ?? "Ukjent merke"} · EAN {data.product.ean ?? "mangler"}</p>
                <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">Pakning</p>
                  <p className="mt-1 text-xl font-bold">{packageLabel(data.product, latest)}</p>
                  <p className="mt-1 text-xs text-muted">Redigeres under Produktdata hvis feil.</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.product.is_basis ? <span className="pill bg-emerald-50 text-brand">Basisvare</span> : <span className="pill bg-slate-100 text-muted">Ikke basis</span>}
                  {data.product.category ? <span className="pill bg-slate-50 text-muted">{data.product.category}</span> : null}
                  {data.product.is_freezable ? <span className="pill bg-sky-50 text-sky-700">Kan fryses</span> : null}
                </div>
              </div>
            </section>

            <section className="card p-5">
              <h2 className="text-lg font-semibold">Må sjekkes</h2>
              {issues.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {issues.map((issue) => <span key={issue} className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">{issue}</span>)}
                </div>
              ) : <p className="mt-2 text-sm text-muted">Ingen åpenbare datamangler.</p>}
            </section>
          </aside>

          <main className="space-y-5">
            <section className="grid grid-cols-4 gap-4">
              <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
                <p className="text-sm font-semibold text-slate-700">Pris nå</p>
                <p className="mt-4 text-4xl font-bold text-slate-950">{kr(latest?.price ?? null)}</p>
                <p className="mt-2 text-sm font-semibold text-muted">{latest ? `${latest.store_name} · ${priceSourceLabel(latest.source)}` : "Ingen pris"}</p>
                {latest ? <span className={`mt-4 inline-flex rounded-full px-3 py-1 text-sm font-bold ${freshnessClass(latest.observed_at)}`}>{freshnessLabel(latest.observed_at)}</span> : null}
              </div>
              <div className="rounded-3xl border border-violet-100 bg-violet-50 p-5">
                <p className="text-sm font-semibold text-slate-700">Enhetspris</p>
                <p className="mt-4 break-words text-4xl font-bold text-slate-950">{unitPriceLabel(latest?.unit_price ?? null, latest?.comparison_unit ?? null)}</p>
                <p className="mt-2 text-sm font-semibold text-muted">{packageLabel(data.product, latest)}</p>
              </div>
              <div className="rounded-3xl border border-amber-100 bg-amber-50 p-5">
                <p className="text-sm font-semibold text-slate-700">Målpris</p>
                <p className="mt-4 text-4xl font-bold text-slate-950">{kr(data.product.target_price)}</p>
                <p className="mt-2 text-sm font-semibold text-muted">{data.product.target_price_unit === "unit_price" ? "Per kg/l/enhet" : "Per stk/pakke"}</p>
              </div>
              <div className={`rounded-3xl border p-5 ${stockTotal < desiredTotal ? "border-rose-100 bg-rose-50" : "border-emerald-100 bg-emerald-50"}`}>
                <p className="text-sm font-semibold text-slate-700">Lager</p>
                <p className="mt-4 text-4xl font-bold text-slate-950">{stockTotal} / {desiredTotal}</p>
                <p className="mt-2 text-sm font-semibold text-muted">Faktisk / ønsket</p>
              </div>
            </section>

            <section className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Nåbeslutning</p>
                  <h2 className="mt-1 text-2xl font-bold">Beste pris for denne forpakningen</h2>
                  <p className="mt-1 text-sm text-muted">Bruker bare priser som er maks 45 dager gamle. Historikk ligger fortsatt i basen.</p>
                </div>
                {bestCurrentPrice ? (
                  <div className="rounded-3xl bg-emerald-50 px-6 py-4 text-right">
                    <p className="text-sm font-bold uppercase tracking-[0.12em] text-brand">Beste nå</p>
                    <p className="mt-1 text-4xl font-bold text-brand">{unitPriceLabel(bestCurrentPrice.unit_price, bestCurrentPrice.comparison_unit)}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">{kr(bestCurrentPrice.price)} · {bestCurrentPrice.store_name}</p>
                  </div>
                ) : null}
              </div>
              {!bestCurrentPrice ? <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">Ingen trygg nåpris. Skann hyllepris for å oppdatere.</p> : null}
            </section>

            <section className="grid grid-cols-[1fr_380px] gap-5">
              <section className="card p-5">
                <h2 className="text-xl font-bold">Produktdata</h2>
                <p className="mt-1 text-sm text-muted">Rett feltene som påvirker kobling, pakningsstørrelse og enhetspris.</p>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <label className="space-y-1 text-sm"><span className="font-semibold">Produktnavn</span><input className="w-full rounded-xl border border-line px-3 py-2" value={String(form.name ?? "")} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                  <label className="space-y-1 text-sm"><span className="font-semibold">Merke</span><input className="w-full rounded-xl border border-line px-3 py-2" value={String(form.brand ?? "")} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label>
                  <label className="space-y-1 text-sm"><span className="font-semibold">Kategori</span><input className="w-full rounded-xl border border-line px-3 py-2" placeholder="Brus, Cashewnøtter, Pasta..." value={String(form.category ?? "")} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
                  <label className="space-y-1 text-sm"><span className="font-semibold">Pakningsstørrelse</span><input className="w-full rounded-xl border border-line px-3 py-2" placeholder="1500 ml, 500 g, 9000 ml" value={String(form.package_size ?? "")} onChange={(e) => setForm({ ...form, package_size: e.target.value })} /><span className="text-xs text-muted">Viktig for riktig kr/kg eller kr/l.</span></label>
                  <label className="space-y-1 text-sm"><span className="font-semibold">EAN</span><input className="w-full rounded-xl border border-line bg-slate-50 px-3 py-2 text-muted" value={data.product.ean ?? ""} readOnly /></label>
                  <label className="space-y-1 text-sm"><span className="font-semibold">Foretrukket butikk</span><input className="w-full rounded-xl border border-line px-3 py-2" placeholder="KIWI, MENY..." value={String(form.preferred_store ?? "")} onChange={(e) => setForm({ ...form, preferred_store: e.target.value })} /></label>
                </div>
              </section>

              <section className="card p-5">
                <h2 className="text-xl font-bold">Basisregler</h2>
                <div className="mt-5 space-y-4">
                  <label className="block space-y-1 text-sm"><span className="font-semibold">Målpris</span><input type="number" step="0.01" className="w-full rounded-xl border border-line px-3 py-2" value={String(form.target_price ?? "")} onChange={(e) => setForm({ ...form, target_price: e.target.value })} /></label>
                  <label className="block space-y-1 text-sm"><span className="font-semibold">Målpris-type</span><select className="w-full rounded-xl border border-line px-3 py-2" value={String(form.target_price_unit ?? "unit")} onChange={(e) => setForm({ ...form, target_price_unit: e.target.value })}><option value="unit">Per stk/pakke</option><option value="unit_price">Per kg/l/enhet</option></select></label>
                  <label className="block space-y-1 text-sm"><span className="font-semibold">Ønsket lager</span><input type="number" step="1" className="w-full rounded-xl border border-line px-3 py-2" value={String(form.desired_stock ?? "")} onChange={(e) => setForm({ ...form, desired_stock: e.target.value })} /></label>
                  <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"><input type="checkbox" checked={Boolean(form.is_basis)} onChange={(e) => setForm({ ...form, is_basis: e.target.checked })} /> Med i basisvarer</label>
                  <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"><input type="checkbox" checked={Boolean(form.is_freezable)} onChange={(e) => setForm({ ...form, is_freezable: e.target.checked })} /> Kan fryses</label>
                </div>
              </section>
            </section>

            <section className="card p-5">
              <h2 className="text-xl font-bold">Notat / regel</h2>
              <textarea className="mt-3 min-h-24 w-full rounded-xl border border-line px-3 py-2" value={String(form.notes ?? "")} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Eksempel: Kjøp når pris er under målpris og lager <= 1." />
            </section>

            <section className="grid grid-cols-[1fr_360px] gap-5">
              <section className="card p-5">
                <h2 className="text-xl font-bold">Prisvedlikehold</h2>
                <p className="mt-1 text-sm text-muted">Viser siste observasjoner for feilretting. Bruk Endre eller Slett hvis en pris er feil.</p>
                <div className="mt-4 space-y-2">
                  {data.price_observations.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold">{item.store_name}</p>
                          <p className="mt-1 text-xs text-muted">{shortDateTime(item.observed_at)} · {priceSourceLabel(item.source)}</p>
                          <p className="mt-1 text-xs text-muted">Pakning: {packageLabel(data.product, item)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-brand">{kr(item.price)}</p>
                          <p className="text-sm font-semibold text-muted">{unitPriceLabel(item.unit_price, item.comparison_unit)}</p>
                          <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-bold ${freshnessClass(item.observed_at)}`}>{freshnessLabel(item.observed_at)}</span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => editPriceObservation(item)} className="rounded-lg border border-line bg-white px-3 py-1 text-xs font-semibold text-slate-700">Endre</button>
                        <button type="button" onClick={() => deletePriceObservation(item)} className="rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700">Slett</button>
                      </div>
                    </div>
                  ))}
                  {!data.price_observations.length ? <p className="text-sm text-muted">Ingen prisobservasjoner ennå.</p> : null}
                </div>
              </section>

              <section className="card p-5">
                <h2 className="text-xl font-bold">Lagerlinjer</h2>
                <div className="mt-4 space-y-2">
                  {data.inventory.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
                      <div className="flex justify-between"><span className="font-semibold">{item.location}</span><span>{item.quantity} / {item.desired_quantity}</span></div>
                      <p className="mt-1 text-xs text-muted">Oppdatert {shortDate(item.updated_at)}</p>
                    </div>
                  ))}
                  {!data.inventory.length ? <p className="text-sm text-muted">Ingen lagerlinje ennå. Lagre produktet for å opprette en.</p> : null}
                </div>
              </section>
            </section>
          </main>
        </div>
      ) : null}
    </AppShell>
  );
}
