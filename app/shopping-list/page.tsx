"use client";

import Link from "next/link";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr } from "@/lib/utils";

type ShoppingList = {
  id: string;
  title: string;
  status: string;
  max_stores: number;
  estimated_total: number | null;
  estimated_saving: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type ShoppingListItem = {
  id: string;
  product_id: string | null;
  product_name: string;
  product_image_url: string | null;
  store_name: string | null;
  quantity: number;
  estimated_price: number | null;
  estimated_saving: number | null;
  status: "planned" | "purchased" | "skipped" | string;
  reason: string | null;
};

type ApiData = {
  list: ShoppingList | null;
  items: ShoppingListItem[];
};

function shortDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function ShoppingListPage() {
  const [data, setData] = useState<ApiData>({ list: null, items: [] });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxStores, setMaxStores] = useState(2);

  async function loadList() {
    setLoading(true);
    setError(null);
    const response = await authFetch("/api/shopping-list/current");
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente handleliste");
      setLoading(false);
      return;
    }
    setData(payload.data ?? { list: null, items: [] });
    setLoading(false);
  }

  async function generateList() {
    setGenerating(true);
    setError(null);
    const response = await authFetch("/api/shopping-list/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxStores })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke generere handleliste");
      setGenerating(false);
      return;
    }
    setData(payload.data ?? { list: null, items: [] });
    setGenerating(false);
  }

  useEffect(() => {
    loadList();
  }, []);

  const plannedItems = data.items.filter((item) => item.status === "planned");
  const skippedItems = data.items.filter((item) => item.status === "skipped");

  const grouped = useMemo(() => {
    const map = new Map<string, ShoppingListItem[]>();
    for (const item of plannedItems) {
      const store = item.store_name ?? "Ukjent butikk";
      const rows = map.get(store) ?? [];
      rows.push(item);
      map.set(store, rows);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "nb"));
  }, [plannedItems]);

  const storeCount = grouped.length;
  const totalItems = plannedItems.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

  return (
    <AppShell active="Handleplan">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">Smart handleliste</h1>
          <p className="mt-2 text-muted">Generer en praktisk handleliste basert på anbefalinger, lager og beste pris.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted">Maks butikker</label>
          <select value={maxStores} onChange={(event) => setMaxStores(Number(event.target.value))} className="rounded-xl border border-line bg-white px-3 py-2 text-sm">
            {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button onClick={loadList} className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-brand">Oppdater</button>
          <button onClick={generateList} disabled={generating} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {generating ? "Genererer..." : "Generer handleliste"}
          </button>
        </div>
      </div>

      {error ? <div className="mt-6 rounded-2xl bg-rose-50 p-4 text-rose-700">{error}</div> : null}

      <div className="mt-8 grid grid-cols-4 gap-5">
        <StatCard title="Estimert total" value={kr(data.list?.estimated_total)} subtitle="Planlagte varer" />
        <StatCard title="Mulig sparing" value={kr(data.list?.estimated_saving)} subtitle="Basert på målpris" tone="blue" />
        <StatCard title="Butikker" value={String(storeCount)} subtitle={`Maks ${data.list?.max_stores ?? maxStores} stopp`} tone="amber" />
        <StatCard title="Varer" value={String(totalItems)} subtitle={`Utelatt: ${skippedItems.length}`} tone="purple" />
      </div>

      <div className="mt-8 grid grid-cols-[1fr_360px] gap-6">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line p-5">
            <div>
              <h2 className="text-lg font-semibold">Handleliste per butikk</h2>
              <p className="text-sm text-muted">Sist generert: {shortDate(data.list?.created_at)}</p>
            </div>
          </div>

          {loading ? <div className="p-10 text-center text-muted">Laster handleliste...</div> : null}

          {!loading && !data.list ? (
            <div className="p-10 text-center text-muted">
              Ingen handleliste ennå. Generer anbefalinger først, og trykk deretter <b>Generer handleliste</b> her.
            </div>
          ) : null}

          {!loading && data.list && grouped.length === 0 ? (
            <div className="p-10 text-center text-muted">Ingen planlagte varer i denne handlelisten.</div>
          ) : null}

          <div className="divide-y divide-line">
            {grouped.map(([store, items]) => {
              const subtotal = items.reduce((sum, item) => sum + Number(item.estimated_price ?? 0), 0);
              return (
                <div key={store} className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-brand">{store}</h3>
                      <p className="text-sm text-muted">{items.length} varer</p>
                    </div>
                    <p className="text-lg font-bold">{kr(subtotal)}</p>
                  </div>

                  <div className="space-y-3">
                    {items.map((item) => (
                      <article key={item.id} className="rounded-2xl border border-line bg-white p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 gap-3">
                            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50">
                              {item.product_image_url ? (
                                <img
                                  src={item.product_image_url}
                                  alt=""
                                  className="h-full w-full object-contain"
                                  onError={(event) => {
                                    event.currentTarget.style.display = "none";
                                  }}
                                />
                              ) : null}
                            </div>
                            <div className="min-w-0">
                              {item.product_id ? (
                                <Link href={`/products/${item.product_id}`} className="font-semibold text-brand hover:underline">{item.product_name}</Link>
                              ) : (
                                <p className="font-semibold">{item.product_name}</p>
                              )}
                              <p className="mt-1 text-sm text-muted">{item.reason}</p>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-bold">{kr(item.estimated_price)}</p>
                            <p className="text-sm text-muted">Antall: {item.quantity}</p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold">Ikke verdt egen tur</h2>
            <p className="mt-1 text-sm text-muted">Varer utenfor maks antall butikker flyttes hit.</p>
            <div className="mt-4 space-y-3">
              {skippedItems.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">
                    {item.product_image_url ? (
                      <img
                        src={item.product_image_url}
                        alt=""
                        className="h-full w-full object-contain"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    {item.product_id ? (
                      <Link href={`/products/${item.product_id}`} className="font-medium text-brand hover:underline">{item.product_name}</Link>
                    ) : (
                      <p className="font-medium">{item.product_name}</p>
                    )}
                    <p className="text-sm text-muted">{item.store_name ?? "Ukjent butikk"} · {kr(item.estimated_price)}</p>
                  </div>
                </div>
              ))}
              {!skippedItems.length ? <p className="text-sm text-muted">Ingen varer utelatt.</p> : null}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Slik brukes listen</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>Importer og synk priser på Produkter-siden.</li>
              <li>Generer anbefalinger.</li>
              <li>Generer smart handleliste.</li>
              <li>Hold deg til maks antall butikker for å spare tid.</li>
            </ol>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
