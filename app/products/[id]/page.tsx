"use client";

import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr } from "@/lib/utils";

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
  openfoodfacts_raw?: unknown | null;
  enrichment_sources?: unknown | null;
  data_quality?: unknown | null;
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
  observed_at: string;
  source: string | null;
  source_url: string | null;
};

type DetailPayload = {
  product: Product;
  inventory: InventoryItem[];
  price_observations: Observation[];
  lowest_by_store: Array<{ store_name: string; price: number; unit_price: number | null; observed_at: string; source: string | null; source_url: string | null }>;
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

function shortJson(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : item?.name ?? item?.label ?? item?.value ?? JSON.stringify(item)))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 12)
      .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
      .join(" · ");
  }
  return String(value);
}

export default function ProductRulesPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const [data, setData] = useState<DetailPayload | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
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
      setError(payload?.error ?? "Kunne ikke lagre regler");
      return;
    }
    setMessage("Produktregler lagret.");
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

  async function enrichProduct() {
    setEnriching(true);
    setError(null);
    setMessage(null);
    const response = await authFetch(`/api/products/${productId}/enrich`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    setEnriching(false);
    if (!response.ok) {
      setError(payload?.error ?? payload?.message ?? "Kunne ikke berike produktdata");
      return;
    }
    setMessage(payload?.message ?? "Produktdata er beriket fra Open Food Facts.");
    await load();
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [productId]);

  const latest = data?.price_observations?.[0] ?? null;
  const stockTotal = useMemo(() => data?.inventory.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0) ?? 0, [data]);
  const desiredTotal = useMemo(() => {
    const desiredValues = data?.inventory.map((item) => Number(item.desired_quantity ?? 0)) ?? [];
    const desiredFromInventory = Math.max(0, ...desiredValues);
    return desiredFromInventory || Number(data?.product.desired_stock ?? 0);
  }, [data]);

  return (
    <AppShell active="Produkter">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/products" className="text-sm font-medium text-brand">← Tilbake til produkter</Link>
          <h1 className="mt-3 text-3xl font-bold">Produkt i basisutvalg</h1>
          <p className="mt-1 text-muted">Sett målpris, lagergrenser og om produktet skal være med i basisutvalget.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncProduct} disabled={syncing || loading} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">
            {syncing ? "Synker..." : "Synk pris for produkt"}
          </button>
          <button onClick={enrichProduct} disabled={enriching || loading || !data?.product.ean} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">
            {enriching ? "Beriker..." : "Berik produktdata"}
          </button>
          <button onClick={save} disabled={saving || loading} className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Lagrer..." : "Lagre regler"}
          </button>
        </div>
      </div>

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      {loading ? <div className="card mt-6 p-10 text-center text-muted">Henter produkt...</div> : null}

      {data ? (
        <>
          <section className="mt-6 grid grid-cols-[280px_1fr] gap-5">
            <div className="card p-5">
              <div className="grid h-44 place-items-center overflow-hidden rounded-2xl bg-slate-50 text-5xl">
                {data.product.image_url ? <img src={data.product.image_url} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : "🛒"}
              </div>
              <h2 className="mt-4 text-xl font-semibold">{data.product.name}</h2>
              <p className="mt-1 text-sm text-muted">{data.product.brand ?? "Ukjent merke"} · EAN {data.product.ean ?? "mangler"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.product.is_basis ? <span className="pill bg-emerald-50 text-brand">Basisutvalg</span> : <span className="pill bg-slate-100 text-muted">Ikke basis</span>}
                {data.product.is_freezable ? <span className="pill bg-sky-50 text-sky-700">Kan fryses</span> : null}
                {data.product.category ? <span className="pill bg-slate-50 text-muted">{data.product.category}</span> : null}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-5">
              <StatCard title="Siste pris" value={kr(latest?.price ?? null)} subtitle={latest ? `${latest.store_name} · ${priceSourceLabel(latest.source)}` : "Ingen prisdata"} />
              <StatCard title="Målpris" value={kr(data.product.target_price)} subtitle={data.product.target_price_unit === "unit_price" ? "Per enhet" : "Per stk/pakke"} tone="amber" />
              <StatCard title="Lager" value={`${stockTotal} / ${desiredTotal}`} subtitle="Faktisk / ønsket" tone={stockTotal < desiredTotal ? "red" : "green"} />
              <StatCard title="Prisobservasjoner" value={String(data.price_observations.length)} subtitle={latest ? `Sist ${shortDateTime(latest.observed_at)} · ${priceSourceLabel(latest.source)}` : "Ingen prisdata"} tone="blue" />
            </div>
          </section>

          <div className="mt-6 grid grid-cols-[1fr_420px] gap-5">
            <section className="card p-5">
              <h2 className="text-lg font-semibold">Basisutvalg, regler og målpris</h2>
              <p className="mt-1 text-sm text-muted">Når Basisutvalg er på, brukes varen i lager, anbefalinger og automatisk handleliste. Slå av for å fjerne den fra basisutvalget uten å slette produktet.</p>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <label className="space-y-1 text-sm"><span className="font-medium">Produktnavn</span><input className="w-full rounded-xl border border-line px-3 py-2" value={String(form.name ?? "")} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Merke</span><input className="w-full rounded-xl border border-line px-3 py-2" value={String(form.brand ?? "")} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Kategori</span><input className="w-full rounded-xl border border-line px-3 py-2" placeholder="Hygiene, Italiensk, Meieri..." value={String(form.category ?? "")} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Pakningsstørrelse</span><input className="w-full rounded-xl border border-line px-3 py-2" value={String(form.package_size ?? "")} onChange={(e) => setForm({ ...form, package_size: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Målpris</span><input type="number" step="0.01" className="w-full rounded-xl border border-line px-3 py-2" value={String(form.target_price ?? "")} onChange={(e) => setForm({ ...form, target_price: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Målpris-type</span><select className="w-full rounded-xl border border-line px-3 py-2" value={String(form.target_price_unit ?? "unit")} onChange={(e) => setForm({ ...form, target_price_unit: e.target.value })}><option value="unit">Per stk/pakke</option><option value="unit_price">Per kg/l/enhet</option></select></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Ønsket lager</span><input type="number" step="1" className="w-full rounded-xl border border-line px-3 py-2" value={String(form.desired_stock ?? "")} onChange={(e) => setForm({ ...form, desired_stock: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Foretrukket butikk</span><input className="w-full rounded-xl border border-line px-3 py-2" placeholder="KIWI, Oda, MENY..." value={String(form.preferred_store ?? "")} onChange={(e) => setForm({ ...form, preferred_store: e.target.value })} /></label>
              </div>

              <div className="mt-5 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2"><input type="checkbox" checked={Boolean(form.is_basis)} onChange={(e) => setForm({ ...form, is_basis: e.target.checked })} /> Med i basisutvalg</label>
                <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2"><input type="checkbox" checked={Boolean(form.is_freezable)} onChange={(e) => setForm({ ...form, is_freezable: e.target.checked })} /> Kan fryses</label>
              </div>

              <label className="mt-5 block space-y-1 text-sm"><span className="font-medium">Notater / regel</span><textarea className="min-h-28 w-full rounded-xl border border-line px-3 py-2" value={String(form.notes ?? "")} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Eksempel: Kjøp OMO under 50 kr når lager <= 1." /></label>
              <section className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Produktdata fra eksterne kilder</h3>
                    <p className="mt-1 text-xs text-muted">Kassalapp og Open Food Facts kan fylle ingredienser, allergener, næring, bilder og kategori. Kontroller alltid emballasjen ved allergi.</p>
                  </div>
                  <button type="button" onClick={enrichProduct} disabled={enriching || loading || !data.product.ean} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-brand disabled:opacity-60">
                    {enriching ? "Beriker..." : "Berik fra Open Food Facts"}
                  </button>
                </div>
                <div className="mt-3 space-y-3 text-sm">
                  {data.product.category_path?.length ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Kategori</p><p>{data.product.category_path.join(" › ")}</p></div>
                  ) : null}
                  {data.product.description ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Beskrivelse</p><p>{data.product.description}</p></div>
                  ) : null}
                  {data.product.ingredients ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Ingredienser</p><p>{data.product.ingredients}</p></div>
                  ) : null}
                  {shortJson(data.product.allergens) ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Allergener</p><p>{shortJson(data.product.allergens)}</p></div>
                  ) : null}
                  {shortJson(data.product.nutrition) ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Næring</p><p>{shortJson(data.product.nutrition)}</p></div>
                  ) : null}
                  {shortJson(data.product.labels) ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Merking</p><p>{shortJson(data.product.labels)}</p></div>
                  ) : null}
                  {shortJson(data.product.enrichment_sources) ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Kilder</p><p>{shortJson(data.product.enrichment_sources)}</p></div>
                  ) : null}
                  {shortJson(data.product.data_quality) ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Datakvalitet</p><p>{shortJson(data.product.data_quality)}</p></div>
                  ) : null}
                  {!data.product.description && !data.product.ingredients && !data.product.allergens && !data.product.nutrition && !data.product.labels && !data.product.category_path?.length ? (
                    <p className="text-muted">Ingen ekstra produktdata lagret ennå. Trykk Berik produktdata eller Synk pris for produkt.</p>
                  ) : null}
                </div>
              </section>

            </section>

            <aside className="space-y-5">
              <section className="card p-5">
                <h2 className="font-semibold">Laveste pris per butikk</h2>
                <div className="mt-4 space-y-2">
                  {data.lowest_by_store.slice(0, 8).map((item) => (
                    <div key={`${item.store_name}-${item.observed_at}`} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
                      <div>
                        <p className="font-medium">{item.store_name}</p>
                        <p className="text-xs text-muted">{shortDateTime(item.observed_at)} · {priceSourceLabel(item.source)}</p>
                      </div>
                      <p className="font-bold text-brand">{kr(item.price)}</p>
                    </div>
                  ))}
                  {!data.lowest_by_store.length ? <p className="text-sm text-muted">Ingen prisobservasjoner ennå.</p> : null}
                </div>
              </section>

              <section className="card p-5">
                <h2 className="font-semibold">Lagerlinjer</h2>
                <div className="mt-4 space-y-2">
                  {data.inventory.map((item) => (
                    <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                      <div className="flex justify-between"><span className="font-medium">{item.location}</span><span>{item.quantity} / {item.desired_quantity}</span></div>
                      <p className="mt-1 text-xs text-muted">Oppdatert {shortDate(item.updated_at)}</p>
                    </div>
                  ))}
                  {!data.inventory.length ? <p className="text-sm text-muted">Ingen lagerlinje ennå. Lagre regler for å opprette en.</p> : null}
                </div>
              </section>
            </aside>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
