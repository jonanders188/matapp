"use client";

import Link from "next/link";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr } from "@/lib/utils";

type BasisProduct = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  target_price: number | null;
  preferred_store: string | null;
  desired_stock: number | null;
  is_basis: boolean | null;
  latest_price?: number | null;
  latest_unit_price?: number | null;
  latest_store?: string | null;
  latest_observed_at?: string | null;
  price_observation_count?: number;
};

function shortDate(value?: string | null) {
  return value ? value.slice(0, 10) : "Ikke synket";
}

function productKey(product: BasisProduct) {
  return product.ean || product.id;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<BasisProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProducts() {
    setLoading(true);
    const response = await authFetch("/api/products?basis=true", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (response.ok) {
      setProducts(payload?.data ?? []);
      return;
    }
    setError(payload?.error ?? "Kunne ikke hente basisutvalg");
  }

  async function syncBasisPrices() {
    setError(null);
    setMessage(null);
    setActionLoading("sync");

    try {
      const response = await authFetch("/api/products/sync-prices", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Synk feilet");
      setMessage(`Prissynk ferdig: ${payload.inserted ?? 0} prisobservasjoner for ${payload.matchedProducts ?? 0} basisprodukter.`);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synk feilet");
    } finally {
      setActionLoading(null);
    }
  }

  async function removeFromBasis(product: BasisProduct) {
    setError(null);
    setMessage(null);
    setActionLoading(`basis-${product.id}`);

    try {
      const response = await authFetch(`/api/products/${product.id}/basis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_basis: false })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kunne ikke fjerne fra basisutvalg");
      setMessage(`${product.name} er fjernet fra basisutvalget. Produktet ligger fortsatt i produktregisteret.`);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke fjerne fra basisutvalg");
    } finally {
      setActionLoading(null);
    }
  }

  useEffect(() => {
    loadProducts().catch(() => undefined);
  }, []);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return products;
    return products.filter((product) => `${product.name} ${product.brand ?? ""} ${product.ean ?? ""} ${product.category ?? ""}`.toLowerCase().includes(normalizedQuery));
  }, [products, query]);

  const productsWithPrices = products.filter((product) => (product.price_observation_count ?? 0) > 0).length;
  const desiredTotal = products.reduce((sum, product) => sum + Number(product.desired_stock ?? 0), 0);
  const latestSync = products
    .map((product) => product.latest_observed_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <AppShell active="Basisutvalg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Basisutvalg</h1>
          <p className="mt-1 text-muted">Dette er husholdningens aktive varer. Lager, priser og synk kjøres bare mot disse produktene.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/catalog" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Finn produkt
          </Link>
          <button
            onClick={syncBasisPrices}
            disabled={Boolean(actionLoading) || !products.length}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {actionLoading === "sync" ? "Synker..." : "Synk basispriser"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Basisvarer" value={String(products.length)} subtitle="Aktive produkter" />
        <StatCard title="Med prisdata" value={String(productsWithPrices)} subtitle="Har observasjoner" tone="blue" />
        <StatCard title="Ønsket behov" value={String(desiredTotal)} subtitle="Sum ønsket lager" tone="amber" />
        <StatCard title="Sist synk" value={shortDate(latestSync)} subtitle="Fra prisobservasjoner" />
      </div>

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-lg font-semibold">Aktive basisvarer</h2>
            <p className="text-sm text-muted">Ta en vare ut av basis for å stoppe lagerstyring og basispris-synk. Produktet slettes ikke.</p>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Søk i basisutvalg..."
            className="min-w-[240px] rounded-xl border border-line px-4 py-2 text-sm outline-none focus:border-brand"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Produkt</th>
                <th className="px-4 py-3">Ønsket</th>
                <th className="px-4 py-3">Målpris</th>
                <th className="px-4 py-3">Siste pris</th>
                <th className="px-4 py-3">Prisdata</th>
                <th className="px-4 py-3 text-right">Handling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {filteredProducts.map((product) => (
                <tr key={productKey(product)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50 text-lg">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt=""
                            className="h-full w-full object-contain"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/products/${product.id}`} className="truncate font-medium text-brand hover:underline">{product.name}</Link>
                        <p className="truncate text-xs text-muted">{product.brand ?? "Ukjent merke"} · {product.ean ?? "EAN mangler"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">{product.desired_stock ?? 0}</td>
                  <td className="px-4 py-3 text-muted">{kr(product.target_price)}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-brand">{kr(product.latest_price ?? null)}</p>
                    <p className="text-xs text-muted">{product.latest_store ?? "Ikke synket"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="pill bg-emerald-50 text-brand">{product.price_observation_count ?? 0} observasjoner</span>
                    <p className="mt-1 text-xs text-muted">{shortDate(product.latest_observed_at)}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <Link href={`/products/${product.id}`} className="text-xs font-semibold text-brand">Rediger</Link>
                      <button
                        type="button"
                        onClick={() => removeFromBasis(product)}
                        disabled={actionLoading === `basis-${product.id}`}
                        className="text-xs font-semibold text-rose-700 disabled:opacity-60"
                      >
                        {actionLoading === `basis-${product.id}` ? "Fjerner..." : "Fjern fra basis"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !filteredProducts.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    Ingen basisvarer funnet. Gå til Produktregister for å legge til varer.
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">Laster basisutvalg...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
