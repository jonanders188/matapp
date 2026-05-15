"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell, StatCard } from "@/components/app-shell";
import { authFetch } from "@/lib/auth-fetch";
import { kr } from "@/lib/utils";

type ProductComparison = {
  productId: string;
  name: string;
  subtitle: string;
  desiredQuantity: number;
  currentQuantity: number;
  targetPrice: number | null;
  lowestStore: string | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  saving: number | null;
  storePrices: Record<string, number>;
  storePriceAgeDays: Record<string, number>;
  storePriceFreshness: Record<string, "fresh" | "fallback">;
  imageUrl: string | null;
};

type StoreComparison = {
  store: string;
  storeKey: string;
  priority: number;
  isEnabled: boolean;
  total: number;
  matchedProducts: number;
  productCount: number;
  coveragePct: number;
  missingProducts: number;
};

type BasisPriceData = {
  products: ProductComparison[];
  stores: StoreComparison[];
  bestStore: StoreComparison | null;
  mostExpensiveStore: StoreComparison | null;
  potentialSaving: number;
  productCount: number;
  pricedProductCount: number;
  storeCount: number;
};

const emptyData: BasisPriceData = {
  products: [],
  stores: [],
  bestStore: null,
  mostExpensiveStore: null,
  potentialSaving: 0,
  productCount: 0,
  pricedProductCount: 0,
  storeCount: 0
};

function priceAgeLabel(ageDays: number | undefined) {
  if (ageDays === undefined || !Number.isFinite(ageDays)) return null;
  if (ageDays === 0) return "i dag";
  if (ageDays === 1) return "1 dag";
  return `${ageDays} dager`;
}

export default function PricesPage() {
  const [data, setData] = useState<BasisPriceData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadPrices() {
    setLoading(true);
    setError(null);

    const response = await authFetch("/api/dashboard/basis-prices", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { data?: BasisPriceData; error?: string } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente prissammenligning");
      setLoading(false);
      return;
    }

    setData(payload?.data ?? emptyData);
    setLoading(false);
  }

  useEffect(() => {
    loadPrices();
  }, []);

  const visibleStores = useMemo(() => {
    return [...data.stores]
      .sort((a, b) => {
        const priorityDiff = a.priority - b.priority;
        if (priorityDiff !== 0) return priorityDiff;
        return a.store.localeCompare(b.store, "nb");
      })
      .slice(0, 6)
      .map((store) => store.store);
  }, [data.stores]);

  const targetPriceHits = data.products.filter((product) => (
    product.lowestPrice !== null &&
    product.targetPrice !== null &&
    product.lowestPrice <= product.targetPrice
  )).length;

  const comparedSubtitle = data.productCount
    ? `${data.pricedProductCount} av ${data.productCount} basisvarer har pris`
    : "Importer eller lagre produkter som basisutvalg";

  return (
    <AppShell active="Prissammenligning">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Prissammenligning</h1>
          <p className="mt-1 text-muted">
            Sammenlign butikker basert på basisutvalget til Damgata 21D, ikke tilfeldige produkter.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/products" className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-brand">
            Endre basisutvalg
          </Link>
          <button onClick={loadPrices} className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-brand">
            Oppdater
          </button>
        </div>
      </div>

      {error ? <div className="mt-6 rounded-2xl bg-rose-50 p-4 text-rose-700">{error}</div> : null}

      <div className="mt-6 grid grid-cols-4 gap-5">
        <StatCard title="Billigste butikk" value={data.bestStore?.store ?? "-"} subtitle={data.bestStore ? `${kr(data.bestStore.total)} for basisutvalget` : "Ingen priser ennå"} />
        <StatCard title="Mulig besparelse" value={kr(data.potentialSaving)} subtitle="Mot dyreste sammenlignbare butikk" tone="blue" />
        <StatCard title="Basisvarer sammenlignet" value={`${data.pricedProductCount}/${data.productCount}`} subtitle={comparedSubtitle} tone="amber" />
        <StatCard title="Under målpris" value={String(targetPriceHits)} subtitle="Basisvarer under ønsket pris" tone="purple" />
      </div>

      <div className="mt-6 grid grid-cols-[1fr_340px] gap-5">
        <section className="card overflow-hidden">
          <div className="border-b border-line p-5">
            <h2 className="text-lg font-semibold">Basisutvalg per butikk</h2>
            <p className="text-sm text-muted">
              Tabellen viser priser fra de siste 30 dagene. Bare priser som er maks 14 dager gamle kan vinne beste pris.
            </p>
          </div>

          {loading ? <div className="p-10 text-center text-muted">Laster prissammenligning...</div> : null}

          {!loading && data.productCount === 0 ? (
            <div className="p-10 text-center text-muted">
              Ingen produkter i basisutvalget ennå. Gå til <Link href="/products" className="font-semibold text-brand">Produkter</Link> og importer eller merk varer som basis.
            </div>
          ) : null}

          {!loading && data.productCount > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-muted">
                  <tr>
                    <th className="p-4">Produkt</th>
                    <th>Basisbehov</th>
                    {visibleStores.map((store, index) => <th key={`${store}-${index}`}>{store}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.products.map((product) => (
                    <tr key={product.productId} className="hover:bg-slate-50">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50">
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt=""
                                className="h-full w-full object-contain"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <Link
                              href={`/products/${product.productId}`}
                              className="font-semibold text-brand hover:underline"
                            >
                              {product.name}
                            </Link>
                            <p className="text-xs text-muted">{product.subtitle || "Basisvare"}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="font-medium">{product.desiredQuantity}</span>
                        <span className="ml-1 text-xs text-muted">ønsket</span>
                      </td>
                      {visibleStores.map((store, index) => {
                        const price = product.storePrices[store];
                        const freshness = product.storePriceFreshness[store];
                        const ageLabel = priceAgeLabel(product.storePriceAgeDays[store]);
                        const isLowest = freshness === "fresh" && product.lowestStore === store;

                        return (
                          <td key={`${store}-${index}`} className={isLowest ? "font-bold text-brand" : freshness === "fallback" ? "text-muted" : ""}>
                            {price === undefined ? (
                              <span className="text-muted">-</span>
                            ) : (
                              <div>
                                <span>{kr(price)}</span>
                                {freshness === "fallback" && ageLabel ? (
                                  <p className="text-[11px] font-normal text-muted">{ageLabel} gammel</p>
                                ) : null}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold">Beste butikk for basisutvalget</h2>
            {data.bestStore ? (
              <div className="mt-4">
                <p className="text-2xl font-bold text-brand">{data.bestStore.store}</p>
                <p className="mt-1 text-sm text-muted">
                  {kr(data.bestStore.total)} · {data.bestStore.matchedProducts}/{data.bestStore.productCount} varer · {data.bestStore.coveragePct}% dekning
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">Synk priser for basisutvalget for å finne beste butikk.</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Butikkrangering</h2>
            <div className="mt-4 space-y-3 text-sm">
              {data.stores.slice(0, 6).map((store, index) => (
                <div key={`${store.store}-${index}`} className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 p-3">
                  <div>
                    <p className="font-semibold">{index + 1}. {store.store}</p>
                    <p className="text-muted">{store.coveragePct}% dekning · mangler {store.missingProducts}</p>
                  </div>
                  <p className="font-bold">{kr(store.total)}</p>
                </div>
              ))}
              {!data.stores.length && !loading ? <p className="text-muted">Ingen butikkpriser funnet.</p> : null}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Hva sammenlignes?</h2>
            <p className="mt-3 text-sm text-muted">
              Prissammenligningen bruker bare produkter som ligger i basisutvalget. Fjern varer fra basisutvalget hvis de ikke skal påvirke billigste butikk, anbefalinger eller handleliste. Priser eldre enn 30 dager skjules, og priser mellom 15 og 30 dager vises bare som gammel fallback.
            </p>
            <Link href="/products" className="mt-4 inline-flex rounded-xl border border-line px-4 py-2 text-sm font-medium text-brand">
              Administrer basisutvalg
            </Link>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
