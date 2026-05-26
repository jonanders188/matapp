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
  lowestStoreKey: string | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  saving: number | null;
  storePrices: Record<string, number>;
  imageUrl: string | null;
};

type StoreComparison = {
  store: string;
  storeKey?: string;
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

export default function DashboardPage() {
  const [data, setData] = useState<BasisPriceData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadBasisPrices() {
    setLoading(true);
    setError(null);

    const response = await authFetch("/api/dashboard/basis-prices", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { data?: BasisPriceData; error?: string } | null;

    if (!response.ok) {
      const message = payload?.error ?? "Kunne ikke hente prissammenligning";

      if (response.status === 403 && message.includes("ikke medlem")) {
        const ensureResponse = await authFetch("/api/onboarding/ensure-household", { method: "POST" });
        const ensurePayload = await ensureResponse.json().catch(() => null) as { data?: { household_id?: string }; error?: string } | null;

        if (ensureResponse.ok && ensurePayload?.data?.household_id) {
          window.localStorage.setItem("matmakt.activeHouseholdId", ensurePayload.data.household_id);
          window.location.reload();
          return;
        }
      }

      setError(message);
      setLoading(false);
      return;
    }

    setData(payload?.data ?? emptyData);
    setLoading(false);
  }

  useEffect(() => {
    loadBasisPrices();
  }, []);

  const topDeals = useMemo(() => {
    return [...data.products]
      .filter((product) => product.lowestPrice !== null)
      .sort((a, b) => Number(b.saving ?? 0) - Number(a.saving ?? 0))
      .slice(0, 5);
  }, [data.products]);

  const lowStockCount = data.products.filter((product) => product.currentQuantity < product.desiredQuantity).length;
  const completeStoreCount = data.stores.filter((store) => store.missingProducts === 0).length;
  const comparedSubtitle = data.productCount
    ? `${data.pricedProductCount} av ${data.productCount} basisvarer har pris`
    : "Start med basisvarene husholdningen faktisk bruker";

  return (
    <AppShell active="Priser">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-heading">Hva vil du gjøre nå?</h1>
          <p className="page-subtitle">Bygg basisvarene fra det dere har hjemme, eller bruk felles prisdata med en gang.</p>
        </div>
        <button onClick={loadBasisPrices} className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-brand">
          Oppdater nåpriser
        </button>
      </div>

      {error ? <div className="mt-6 rounded-2xl bg-rose-50 p-4 text-rose-700">{error}</div> : null}

      {!loading && data.productCount === 0 ? (
        <section className="mt-6 grid gap-3 lg:grid-cols-3">
          <Link href="/mobile2" className="rounded-3xl border border-emerald-100 bg-emerald-700 p-5 text-white shadow-sm transition hover:bg-emerald-800">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Start her</p>
            <h2 className="mt-2 text-2xl font-black">Skann hjemmevarer</h2>
            <p className="mt-2 text-sm font-semibold text-emerald-50">Bygg basisvarer fra kjøleskap, fryser, skuffer og skap. Ingen pris trengs.</p>
          </Link>
          <Link href="/mobile2" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Etter handel</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Skann kvittering</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">Matmakt matcher kvitteringen mot basisvarene. Ukjente varer kan skannes etterpå.</p>
          </Link>
          <Link href="/onboarding?force=1" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Husholdning</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Inviter medlemmer</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">E-post er nok. Alle i husholdningen kan hjelpe til med lager, basisvarer og kvitteringer.</p>
          </Link>
        </section>
      ) : null}

      {!loading && data.productCount > 0 ? (
        <section className="mt-6 rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Neste steg</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Basisvarene er i gang</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">Bruk dashboardet til nåpriser. Skann flere hjemmevarer eller kvittering når det passer.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/mobile2" className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">Skann hjemmevarer</Link>
              <Link href="/mobile2" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800">Skann kvittering</Link>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <StatCard title="Beste butikk nå" value={data.bestStore?.store ?? "-"} subtitle={data.bestStore ? `${kr(data.bestStore.total)} · ${data.bestStore.coveragePct}% dekning` : "Ingen priser ennå"} />
        <StatCard title="Mulig å spare" value={kr(data.potentialSaving)} subtitle="Mot dyreste sammenlignbare butikk" tone="blue" />
        <StatCard title="Basisvarer med pris" value={`${data.pricedProductCount}/${data.productCount}`} subtitle={comparedSubtitle} tone="amber" />
        <StatCard title="Varer å fylle på" value={String(lowStockCount)} subtitle="Lavere enn ønsket lager" tone="purple" />
      </div>

      <section className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-5">
          <div>
            <h2 className="section-title">Beste kjøp på basisvarene</h2>
            <p className="text-sm leading-6 text-muted">Bare husholdningens basisvarer brukes her. Historikk ligger i databasen, men nåvisningen fokuserer på aktuelle priser.</p>
          </div>
          <Link href="/products" className="text-sm font-medium text-brand">Administrer basisutvalg</Link>
        </div>

        {loading ? <div className="p-10 text-center text-muted">Laster prissammenligning...</div> : null}

        {!loading && data.productCount === 0 ? (
          <div className="p-10 text-center text-muted">
            Ingen basisvarer ennå. Start med å <Link href="/mobile2" className="font-semibold text-brand">skanne hjemmevarene dine</Link>, så vises prissammenligningen her.
          </div>
        ) : null}

        {!loading && data.productCount > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="p-4">Produkt</th>
                  <th>Ønsket</th>
                  <th>På lager</th>
                  <th>Laveste pris</th>
                  <th>Butikk</th>
                  <th>Forskjell</th>
                  <th>Status</th>
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
                          <Link href={`/products/${product.productId}`} className="font-semibold text-brand hover:underline">{product.name}</Link>
                          <p className="text-xs text-muted">{product.subtitle || "Basisvare"}</p>
                        </div>
                      </div>
                    </td>
                    <td>{product.desiredQuantity}</td>
                    <td className={product.currentQuantity < product.desiredQuantity ? "font-semibold text-amber-700" : "text-brand"}>{product.currentQuantity}</td>
                    <td className="font-semibold text-brand">{kr(product.lowestPrice)}</td>
                    <td>{product.lowestStore ?? "-"}</td>
                    <td>{product.saving ? kr(product.saving) : "-"}</td>
                    <td>
                      <span className={product.lowestPrice === null ? "pill bg-slate-100 text-slate-600" : product.targetPrice && product.lowestPrice <= product.targetPrice ? "pill bg-brand-soft text-brand" : "pill bg-amber-50 text-amber-700"}>
                        {product.lowestPrice === null ? "Mangler pris" : product.targetPrice && product.lowestPrice <= product.targetPrice ? "Under målpris" : "Følg med"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="section-title">Butikker for basisvarene</h2>
              <p className="text-sm leading-6 text-muted">Dekning viser hvor mange basisvarer butikken har pris på.</p>
            </div>
            <span className="pill bg-brand-soft text-brand">{completeStoreCount} komplette</span>
          </div>

          <div className="space-y-3">
            {data.stores.slice(0, 6).map((store, index) => (
              <div key={store.storeKey} className="flex items-center justify-between rounded-2xl border border-line p-4">
                <div>
                  <p className="font-semibold">{index + 1}. {store.store}</p>
                  <p className="text-sm leading-6 text-muted">{store.matchedProducts}/{store.productCount} varer · {store.coveragePct}% dekning</p>
                </div>
                <p className="text-lg font-bold">{kr(store.total)}</p>
              </div>
            ))}
            {!data.stores.length && !loading ? <p className="text-sm leading-6 text-muted">Ingen butikkpriser funnet for basisutvalget.</p> : null}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold">Beste kjøp akkurat nå</h2>
            <p className="section-subtitle">Størst prisforskjell mellom butikkene for basisvarer.</p>
            <div className="mt-4 space-y-3">
              {topDeals.map((product) => (
                <Link key={product.productId} href={`/products/${product.productId}`} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 hover:bg-slate-100">
                  <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">
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
                    <p className="truncate font-medium text-slate-900">{product.name}</p>
                    <p className="text-sm leading-6 text-muted">{product.lowestStore} · {kr(product.lowestPrice)} · spar opptil {kr(product.saving)}</p>
                  </div>
                </Link>
              ))}
              {!topDeals.length && !loading ? <p className="text-sm leading-6 text-muted">Synk priser for å se beste kjøp.</p> : null}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Hva betyr basisutvalg?</h2>
            <p className="mt-3 text-sm text-muted">Basisutvalget er varene dere faktisk vil følge med på i husholdningen. Forsiden bruker bare disse varene, slik at prissammenligningen ikke fylles med produkter dere ikke bryr dere om.</p>
            <Link href="/products" className="mt-4 inline-flex rounded-xl border border-line px-4 py-2 text-sm font-medium text-brand">Endre basisutvalg</Link>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
