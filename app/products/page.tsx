"use client";

import Link from "next/link";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr } from "@/lib/utils";
import type { KassalappProduct } from "@/lib/kassalapp";

type SavedProduct = {
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

function latestDate(product: KassalappProduct) {
  return product.price_history?.[0]?.date?.slice(0, 10) ?? "Ukjent dato";
}

function shortDate(value?: string | null) {
  return value ? value.slice(0, 10) : "Ikke synket";
}

function productKey(product: SavedProduct) {
  return product.ean || product.id;
}

export default function ProductsPage() {
  const [query, setQuery] = useState("San Marzano");
  const [results, setResults] = useState<KassalappProduct[]>([]);
  const [saved, setSaved] = useState<SavedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSaved() {
    const response = await authFetch("/api/products", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      setSaved(payload?.data ?? []);
      return;
    }
    setError(payload?.error ?? "Kunne ikke hente lagrede produkter");
  }

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch(`/api/kassalapp/search?q=${encodeURIComponent(query.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Søk feilet");
      setResults(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Søk feilet");
    } finally {
      setLoading(false);
    }
  }

  async function saveProduct(product: KassalappProduct, priceProducts: KassalappProduct[] = []) {
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
      console.error("Kunne ikke lagre produkt", payload);
      const details = [payload?.details, payload?.hint].filter(Boolean).join(" ");
      setError(`${payload?.error ?? "Kunne ikke lagre produkt"}${details ? ` — ${details}` : ""}`);
      return;
    }
    const warnings = payload?.warnings?.length ? ` Advarsel: ${payload.warnings.join(", ")}` : "";
    const insertedPrices = Number(payload?.priceObservationsInserted ?? 0);
    setMessage(`${product.name} er lagt til i basisutvalget med ${insertedPrices} butikkpriser.${warnings}`);
    await loadSaved();
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
      await loadSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synk feilet");
    } finally {
      setActionLoading(null);
    }
  }

  async function enrichBasisProducts() {
    setError(null);
    setMessage(null);
    setActionLoading("enrich-basis");

    try {
      const response = await authFetch("/api/products/enrich-basis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10 })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Beriking feilet");

      const errors = Array.isArray(payload?.errors) && payload.errors.length ? ` ${payload.errors.length} feil.` : "";
      setMessage(`Open Food Facts: forsøkte ${payload?.attempted ?? 0}, fant ${payload?.found ?? 0}, oppdaterte ${payload?.updated ?? 0}. Hoppet over ${payload?.skippedAlreadyComplete ?? 0} komplette og ${payload?.skippedNoEan ?? 0} uten EAN.${errors}`);
      await loadSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beriking feilet");
    } finally {
      setActionLoading(null);
    }
  }

  async function setBasisProduct(product: SavedProduct, isBasis: boolean) {
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
      await loadSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oppdatere basisutvalg");
    } finally {
      setActionLoading(null);
    }
  }

  useEffect(() => {
    loadSaved().catch(() => undefined);
  }, []);

  const grouped = useMemo(() => {
    return results.reduce<Record<string, KassalappProduct[]>>((acc, product) => {
      const key = product.ean || product.name;
      acc[key] = acc[key] ?? [];
      acc[key].push(product);
      return acc;
    }, {});
  }, [results]);

  const basisProducts = saved.filter((product) => Boolean(product.is_basis));
  const productsWithPrices = saved.filter((product) => (product.price_observation_count ?? 0) > 0).length;
  const latestSync = saved
    .map((product) => product.latest_observed_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <AppShell active="Produkter">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold">Basisutvalg</h1>
          <p className="mt-1 text-muted">Produkter du importerer eller lagrer blir automatisk basisutvalg for Damgata 21D.</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/health" className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-brand">Sjekk API-status</a>
          <a href="/recommendations" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Anbefalinger</a>
          <button
            onClick={enrichBasisProducts}
            disabled={Boolean(actionLoading) || !basisProducts.length}
            className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-brand disabled:opacity-60"
          >
            {actionLoading === "enrich-basis" ? "Beriker..." : "Berik basisprodukter"}
          </button>
          <button
            onClick={syncBasisPrices}
            disabled={Boolean(actionLoading) || !saved.length}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {actionLoading === "sync" ? "Synker..." : "Synk basispriser"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-5">
        <StatCard title="Basisutvalg" value={String(basisProducts.length)} subtitle="Brukes til lager og handleliste" />
        <StatCard title="Med prisdata" value={String(productsWithPrices)} subtitle="Har observasjoner" tone="blue" />
        <StatCard title="Alle lagrede" value={String(saved.length)} subtitle="Produkter i husholdningen" tone="amber" />
        <StatCard title="Sist synk" value={shortDate(latestSync)} subtitle="Fra prisobservasjoner" />
      </div>

      <section className="card mt-6 p-5">
        <form onSubmit={search} className="flex gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Søk etter EAN eller produktnavn, f.eks. OMO Ultra Hvitt"
            className="min-w-0 flex-1 rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
          />
          <button disabled={loading} className="rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? "Søker..." : "Søk i Kassalapp"}
          </button>
        </form>
        <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-brand">
          Alt du lagrer her blir lagt i basisutvalget. Fjern fra basisutvalget når varen ikke lenger skal styre lager, anbefalinger og handleliste. Produktet slettes ikke.
        </p>
        {message ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}
        {error ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      </section>

      <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Kassalapp-søk</h2>
              <p className="text-sm text-muted">Resultatene vises rett under søket. Trykk Legg i basisutvalg for å lagre produktdata, næringsdata, kategori og alle butikkprisene som vises.</p>
            </div>

            {Object.entries(grouped).map(([key, products]) => {
              const primary = products[0];
              const prices = products.filter((product) => product.current_price != null);
              const lowest = [...prices].sort((a, b) => (a.current_price ?? 0) - (b.current_price ?? 0))[0];

              return (
                <article key={key} className="card p-5">
                  <div className="flex gap-4">
                    <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-slate-50 text-4xl">
                      {primary.image ? (
                        <img
                          src={primary.image}
                          alt=""
                          className="h-full w-full object-contain"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold">{primary.name}</h2>
                          <p className="text-sm text-muted">{primary.brand ?? "Ukjent merke"} · EAN {primary.ean ?? "mangler"}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            {primary.category?.map((category) => (
                              <span key={`${primary.id}-${category.name}`} className="rounded-full bg-slate-100 px-2 py-1 text-muted">{category.name}</span>
                            ))}
                            {primary.ingredients ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-brand">Ingredienser</span> : null}
                            {primary.nutrition || primary.nutrients ? <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">Næring</span> : null}
                            {primary.allergens ? <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">Allergener</span> : null}
                          </div>
                        </div>
                        <button
                          onClick={() => saveProduct(primary, products)}
                          disabled={actionLoading === `save-${primary.id}`}
                          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {actionLoading === `save-${primary.id}` ? "Lagrer..." : `Legg i basisutvalg (${prices.length || products.length} priser)`}
                        </button>
                      </div>
                      <div className="mt-4 grid grid-cols-4 gap-3">
                        {products.slice(0, 4).map((product) => (
                          <div key={`${product.id}-${product.store?.code}`} className="rounded-xl border border-line p-3 text-sm">
                            <p className="font-semibold">{product.store?.name ?? "Ukjent"}</p>
                            <p className="mt-1 text-xl font-bold text-brand">{kr(product.current_price)}</p>
                            <p className="text-xs text-muted">Enhet {kr(product.current_unit_price)}</p>
                            <p className="mt-2 text-xs text-muted">{latestDate(product)}</p>
                          </div>
                        ))}
                      </div>
                      {lowest ? (
                        <p className="mt-4 text-sm text-muted">
                          Laveste pris: <b className="text-brand">{kr(lowest.current_price)}</b> hos {lowest.store?.name ?? "ukjent butikk"}.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
            {!results.length ? <div className="card p-8 text-center text-muted">Søk etter et produkt for å hente priser fra Kassalapp.</div> : null}
          </section>

      <div className="mt-6 grid grid-cols-[1fr_420px] gap-5">
        <section className="space-y-5">
          <section className="card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Basisutvalg og lagrede produkter</h2>
                <p className="text-sm text-muted">Basisutvalget er varene som skal følges opp i lager, anbefalinger og handleliste. Du kan fjerne en vare fra basis uten å slette den.</p>
              </div>
              <button onClick={loadSaved} className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-brand">Oppdater</button>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Produkt</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Målpris</th>
                    <th className="px-4 py-3">Siste pris</th>
                    <th className="px-4 py-3">Handling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {saved.map((product) => (
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
                      <td className="px-4 py-3">
                        {product.is_basis ? (
                          <span className="pill bg-emerald-50 text-brand">Basisutvalg</span>
                        ) : (
                          <span className="pill bg-slate-100 text-muted">Ikke basis</span>
                        )}
                        <p className="mt-1 text-xs text-muted">Ønsket lager: {product.desired_stock ?? 0}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">{kr(product.target_price)}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-brand">{kr(product.latest_price ?? null)}</p>
                        <p className="text-xs text-muted">{product.latest_store ?? "Ikke synket"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="pill bg-emerald-50 text-brand">{product.price_observation_count ?? 0} observasjoner</span>
                        <p className="mt-1 text-xs text-muted">{shortDate(product.latest_observed_at)}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link href={`/products/${product.id}`} className="text-xs font-semibold text-brand">Rediger →</Link>
                          {product.is_basis ? (
                            <button
                              type="button"
                              onClick={() => setBasisProduct(product, false)}
                              disabled={actionLoading === `basis-${product.id}`}
                              className="text-xs font-semibold text-rose-700 disabled:opacity-60"
                            >
                              {actionLoading === `basis-${product.id}` ? "Fjerner..." : "Fjern fra basis"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setBasisProduct(product, true)}
                              disabled={actionLoading === `basis-${product.id}`}
                              className="text-xs font-semibold text-brand disabled:opacity-60"
                            >
                              {actionLoading === `basis-${product.id}` ? "Legger til..." : "Legg til basis"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!saved.length ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted">Ingen produkter lagret ennå. Bruk søk i Kassalapp for å legge til produkter.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>


        </section>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold">Neste handlinger</h2>
            <div className="mt-4 space-y-3 text-sm text-muted">
              <p><b className="text-slate-900">Synk basispriser</b> henter nye Kassalapp-priser kun for produkter i basisutvalget.</p>
              <p><b className="text-slate-900">Kassalapp-søk</b> brukes når du vil legge til enkeltvarer i basisutvalget eller rette en variant.</p>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Sist lagret</h2>
            <div className="mt-4 space-y-3">
              {saved.slice(0, 8).map((product) => (
                <div key={product.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white">
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
                  <div className="min-w-0 flex-1">
                    <Link href={`/products/${product.id}`} className="truncate font-medium text-brand hover:underline">{product.name}</Link>
                    <p className="text-xs text-muted">{product.latest_store ?? product.preferred_store ?? "Ingen butikk"} · {kr(product.latest_price ?? product.target_price)}</p>
                  </div>
                </div>
              ))}
              {!saved.length ? <p className="text-sm text-muted">Ingen produkter lagret ennå.</p> : null}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
