"use client";

import Link from "next/link";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr } from "@/lib/utils";
import type { KassalappProduct } from "@/lib/kassalapp";

type CatalogProduct = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  is_basis: boolean | null;
  is_in_household: boolean;
  desired_stock: number | null;
  target_price: number | null;
  preferred_store: string | null;
  latest_price?: number | null;
  latest_store?: string | null;
  latest_observed_at?: string | null;
  price_observation_count?: number;
};

function latestDate(product: KassalappProduct) {
  return product.price_history?.[0]?.date?.slice(0, 10) ?? "Ukjent dato";
}

function shortDate(value?: string | null) {
  return value ? value.slice(0, 10) : "Ikke synket";
}

function productKey(product: CatalogProduct) {
  return product.ean || product.id;
}

export default function CatalogPage() {
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [kassalappQuery, setKassalappQuery] = useState("San Marzano");
  const [kassalappResults, setKassalappResults] = useState<KassalappProduct[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingKassalapp, setLoadingKassalapp] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCatalog(nextQuery = catalogQuery) {
    setLoadingCatalog(true);
    setError(null);
    const url = nextQuery.trim() ? `/api/catalog?q=${encodeURIComponent(nextQuery.trim())}` : "/api/catalog";
    const response = await authFetch(url, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    setLoadingCatalog(false);
    if (response.ok) {
      setCatalogProducts(payload?.data ?? []);
      return;
    }
    setError(payload?.error ?? "Kunne ikke hente produktregister");
  }

  async function searchCatalog(event?: React.FormEvent) {
    event?.preventDefault();
    await loadCatalog(catalogQuery);
  }

  async function searchKassalapp(event?: React.FormEvent) {
    event?.preventDefault();
    if (!kassalappQuery.trim()) return;

    setLoadingKassalapp(true);
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch(`/api/kassalapp/search?q=${encodeURIComponent(kassalappQuery.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Søk feilet");
      setKassalappResults(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Søk feilet");
    } finally {
      setLoadingKassalapp(false);
    }
  }

  async function saveKassalappProduct(product: KassalappProduct, priceProducts: KassalappProduct[] = []) {
    setError(null);
    setMessage(null);
    setActionLoading(`save-${product.id}`);
    const response = await authFetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, priceProducts })
    });
    const payload = await response.json().catch(() => null);
    setActionLoading(null);
    if (!response.ok) {
      const details = [payload?.details, payload?.hint].filter(Boolean).join(" ");
      setError(`${payload?.error ?? "Kunne ikke lagre produkt"}${details ? ` — ${details}` : ""}`);
      return;
    }
    const warnings = payload?.warnings?.length ? ` Advarsel: ${payload.warnings.join(", ")}` : "";
    const insertedPrices = Number(payload?.priceObservationsInserted ?? 0);
    setMessage(`${product.name} er lagt til i basisutvalget med ${insertedPrices} butikkpriser.${warnings}`);
    await loadCatalog(catalogQuery);
  }

  async function setBasisProduct(product: CatalogProduct, isBasis: boolean) {
    setError(null);
    setMessage(null);
    setActionLoading(`basis-${product.id}`);

    try {
      const response = await authFetch(`/api/products/${product.id}/basis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_basis: isBasis })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kunne ikke oppdatere basisutvalg");
      setMessage(isBasis ? `${product.name} er lagt til i basisutvalget.` : `${product.name} er fjernet fra basisutvalget.`);
      await loadCatalog(catalogQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oppdatere basisutvalg");
    } finally {
      setActionLoading(null);
    }
  }

  useEffect(() => {
    loadCatalog("").catch(() => undefined);
  }, []);

  const groupedKassalapp = useMemo(() => {
    return kassalappResults.reduce<Record<string, KassalappProduct[]>>((acc, product) => {
      const key = product.ean || product.name;
      acc[key] = acc[key] ?? [];
      acc[key].push(product);
      return acc;
    }, {});
  }, [kassalappResults]);

  const basisCount = catalogProducts.filter((product) => product.is_basis).length;
  const withPrices = catalogProducts.filter((product) => (product.price_observation_count ?? 0) > 0).length;

  return (
    <AppShell active="Produktregister">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Produktregister</h1>
          <p className="mt-1 text-muted">Søk i globale produkter eller hent fra Kassalapp. Velg hvilke produkter som skal inn i basisutvalget.</p>
        </div>
        <Link href="/products" className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
          Se basisutvalg
        </Link>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        <StatCard title="Treff i register" value={String(catalogProducts.length)} subtitle="Vises under" />
        <StatCard title="I basis" value={String(basisCount)} subtitle="Av treffene" tone="blue" />
        <StatCard title="Med prisdata" value={String(withPrices)} subtitle="Prisobservasjoner finnes" tone="amber" />
      </div>

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <section className="card mt-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Søk i produktregister</h2>
            <p className="text-sm text-muted">Dette søker i produkter som allerede finnes i databasen.</p>
          </div>
        </div>
        <form onSubmit={searchCatalog} className="mt-4 flex flex-wrap gap-3">
          <input
            value={catalogQuery}
            onChange={(event) => setCatalogQuery(event.target.value)}
            placeholder="Søk etter navn, merke, EAN eller kategori"
            className="min-w-[260px] flex-1 rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
          />
          <button disabled={loadingCatalog} className="rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {loadingCatalog ? "Søker..." : "Søk"}
          </button>
        </form>
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-lg font-semibold">Globale produkter</h2>
          <p className="text-sm text-muted">Produkter som tas ut av basisutvalget blir liggende her og kan legges inn igjen senere.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Produkt</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Siste pris</th>
                <th className="px-4 py-3">Prisdata</th>
                <th className="px-4 py-3 text-right">Handling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {catalogProducts.map((product) => (
                <tr key={productKey(product)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50 text-lg">
                        {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/products/${product.id}`} className="truncate font-medium text-brand hover:underline">{product.name}</Link>
                        <p className="truncate text-xs text-muted">{product.brand ?? "Ukjent merke"} · {product.ean ?? "EAN mangler"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {product.is_basis ? <span className="pill bg-emerald-50 text-brand">I basis</span> : <span className="pill bg-slate-100 text-muted">Ikke basis</span>}
                    {product.is_in_household && !product.is_basis ? <p className="mt-1 text-xs text-muted">Kjent for husholdningen</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-brand">{kr(product.latest_price ?? null)}</p>
                    <p className="text-xs text-muted">{product.latest_store ?? "Ikke synket"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="pill bg-emerald-50 text-brand">{product.price_observation_count ?? 0} observasjoner</span>
                    <p className="mt-1 text-xs text-muted">{shortDate(product.latest_observed_at)}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {product.is_basis ? (
                      <button type="button" onClick={() => setBasisProduct(product, false)} disabled={actionLoading === `basis-${product.id}`} className="text-xs font-semibold text-rose-700 disabled:opacity-60">
                        {actionLoading === `basis-${product.id}` ? "Fjerner..." : "Fjern fra basis"}
                      </button>
                    ) : (
                      <button type="button" onClick={() => setBasisProduct(product, true)} disabled={actionLoading === `basis-${product.id}`} className="text-xs font-semibold text-brand disabled:opacity-60">
                        {actionLoading === `basis-${product.id}` ? "Legger til..." : "Legg til basis"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loadingCatalog && !catalogProducts.length ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Ingen produkter funnet.</td></tr>
              ) : null}
              {loadingCatalog ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Laster produktregister...</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card mt-6 p-5">
        <div>
          <h2 className="text-lg font-semibold">Søk i Kassalapp</h2>
          <p className="text-sm text-muted">Bruk dette når produktet ikke finnes i produktregisteret. Valgte produkter legges direkte i basisutvalget.</p>
        </div>
        <form onSubmit={searchKassalapp} className="mt-4 flex flex-wrap gap-3">
          <input
            value={kassalappQuery}
            onChange={(event) => setKassalappQuery(event.target.value)}
            placeholder="Søk etter EAN eller produktnavn"
            className="min-w-[260px] flex-1 rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
          />
          <button disabled={loadingKassalapp} className="rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {loadingKassalapp ? "Søker..." : "Søk i Kassalapp"}
          </button>
        </form>

        <div className="mt-5 space-y-4">
          {Object.entries(groupedKassalapp).map(([key, products]) => {
            const primary = products[0];
            const prices = products.filter((product) => product.current_price != null);
            const lowest = [...prices].sort((a, b) => (a.current_price ?? 0) - (b.current_price ?? 0))[0];

            return (
              <article key={key} className="rounded-2xl border border-line p-4">
                <div className="flex flex-col gap-4 md:flex-row">
                  <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-slate-50 text-4xl">
                    {primary.image ? <img src={primary.image} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">{primary.name}</h3>
                        <p className="text-sm text-muted">{primary.brand ?? "Ukjent merke"} · EAN {primary.ean ?? "mangler"}</p>
                        {lowest ? <p className="mt-2 text-sm text-muted">Laveste pris: <b className="text-brand">{kr(lowest.current_price)}</b> hos {lowest.store?.name ?? "ukjent butikk"}.</p> : null}
                      </div>
                      <button
                        onClick={() => saveKassalappProduct(primary, products)}
                        disabled={actionLoading === `save-${primary.id}`}
                        className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {actionLoading === `save-${primary.id}` ? "Lagrer..." : `Legg i basisutvalg (${prices.length || products.length} priser)`}
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {products.slice(0, 4).map((product) => (
                        <div key={`${product.id}-${product.store?.code}`} className="rounded-xl border border-line p-3 text-sm">
                          <p className="font-semibold">{product.store?.name ?? "Ukjent"}</p>
                          <p className="mt-1 text-xl font-bold text-brand">{kr(product.current_price)}</p>
                          <p className="text-xs text-muted">Enhet {kr(product.current_unit_price)}</p>
                          <p className="mt-2 text-xs text-muted">{latestDate(product)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          {!kassalappResults.length ? <div className="rounded-2xl bg-slate-50 p-6 text-center text-muted">Søk i Kassalapp for å hente nye produkter inn i registeret.</div> : null}
        </div>
      </section>
    </AppShell>
  );
}
