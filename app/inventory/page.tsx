"use client";

import Link from "next/link";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { cx } from "@/lib/utils";

type InventoryStatus = "På lager" | "Lavt lager" | "Tomt" | "Overfylt";

type InventoryItem = {
  id: string;
  product_id: string;
  location: string;
  quantity: number;
  desired_quantity: number;
  expires_at: string | null;
  updated_at: string | null;
  status: InventoryStatus;
  product: {
    id: string;
    name: string;
    brand: string | null;
    category: string | null;
    package_size: string | null;
    image_url: string | null;
    target_price: number | null;
    preferred_store: string | null;
  } | null;
  latest_price: number | null;
  latest_store: string | null;
  latest_observed_at: string | null;
  price_observation_count: number;
};

type InventoryStats = {
  total: number;
  low: number;
  empty: number;
  overstocked: number;
  needsRestock: number;
};

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 2 }).format(value);
}

function shortDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(value));
}

function statusClasses(status: InventoryStatus) {
  switch (status) {
    case "På lager":
      return "bg-emerald-50 text-brand";
    case "Lavt lager":
      return "bg-amber-50 text-amber-700";
    case "Tomt":
      return "bg-rose-50 text-rose-700";
    case "Overfylt":
      return "bg-sky-50 text-sky-700";
    default:
      return "bg-slate-50 text-slate-600";
  }
}

function imageFor(item: InventoryItem) {
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50">
      {item.product?.image_url ? (
        <img
          src={item.product.image_url}
          alt=""
          className="h-full w-full object-contain"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </div>
  );
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stats, setStats] = useState<InventoryStats>({ total: 0, low: 0, empty: 0, overstocked: 0, needsRestock: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"alle" | InventoryStatus>("alle");
  const [error, setError] = useState<string | null>(null);

  async function loadInventory() {
    setLoading(true);
    setError(null);

    try {
      const response = await authFetch("/api/inventory", { cache: "no-store" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Kunne ikke hente lager");
        return;
      }

      setItems(payload.data ?? []);
      setStats(payload.stats ?? { total: 0, low: 0, empty: 0, overstocked: 0, needsRestock: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente lager");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInventory();
  }, []);

  async function updateItem(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);

    try {
      const response = await fetch(`/api/inventory/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Kunne ikke oppdatere lager");
        return;
      }

      await loadInventory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oppdatere lager");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = `${item.product?.name ?? ""} ${item.product?.brand ?? ""} ${item.product?.category ?? ""} ${item.location}`.toLowerCase();
      const queryMatch = !normalizedQuery || haystack.includes(normalizedQuery);
      const statusMatch = statusFilter === "alle" || item.status === statusFilter;
      return queryMatch && statusMatch;
    });
  }, [items, query, statusFilter]);

  const restockItems = items.filter((item) => item.status === "Lavt lager" || item.status === "Tomt").slice(0, 8);
  const doNotBuyItems = items.filter((item) => item.status === "På lager" || item.status === "Overfylt").slice(0, 6);

  return (
    <AppShell active="Lager">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Lager</h1>
          <p className="mt-1 text-muted">Oppdater beholdning raskt med +, -, tomt og ønsket nivå.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => void loadInventory()} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Oppdater lager
          </button>
          <a href="/products" className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
            Legg til produkter
          </a>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-4">
        <StatCard title="Totale lagerlinjer" value={String(stats.total)} subtitle="Fra Supabase" />
        <StatCard title="Lavt lager" value={String(stats.low)} subtitle="Under ønsket nivå" tone="amber" />
        <StatCard title="Tomt" value={String(stats.empty)} subtitle="Bør fylles på" tone="red" />
        <StatCard title="Trenger påfyll" value={String(stats.needsRestock)} subtitle="Vises i høyre panel" tone="purple" />
      </div>

      {error ? <div className="mt-5 rounded-2xl bg-rose-50 p-4 font-medium text-rose-700">{error}</div> : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Søk i lageret..."
              className="min-w-[260px] flex-1 rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
            >
              <option value="alle">Alle statuser</option>
              <option value="På lager">På lager</option>
              <option value="Lavt lager">Lavt lager</option>
              <option value="Tomt">Tomt</option>
              <option value="Overfylt">Overfylt</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="p-4">Produkt</th>
                  <th>Mengde</th>
                  <th>Ønsket</th>
                  <th>Sted</th>
                  <th>Siste pris</th>
                  <th>Status</th>
                  <th className="text-right pr-4">Handling</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted">Henter lager...</td>
                  </tr>
                ) : filtered.length ? (
                  filtered.map((item) => (
                    <tr key={item.id} className="align-middle">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {imageFor(item)}
                          <div>
                            {item.product ? (
                              <Link href={`/products/${item.product.id}`} className="font-semibold text-brand hover:underline">
                                {item.product.name}
                              </Link>
                            ) : (
                              <p className="font-semibold text-slate-900">Ukjent produkt</p>
                            )}
                            <p className="text-xs text-muted">{item.product?.brand ?? item.product?.category ?? "-"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="font-semibold">{item.quantity} stk</td>
                      <td>{item.desired_quantity} stk</td>
                      <td>{item.location}</td>
                      <td>
                        <div className="font-semibold">{money(item.latest_price)}</div>
                        <div className="text-xs text-muted">{item.latest_store ?? "-"} · {shortDate(item.latest_observed_at)}</div>
                      </td>
                      <td><span className={cx("pill", statusClasses(item.status))}>{item.status}</span></td>
                      <td className="pr-4">
                        <div className="flex justify-end gap-2">
                          <button disabled={busyId === item.id} onClick={() => void updateItem(item.id, { action: "decrement" })} className="rounded-lg border border-line px-3 py-2 font-semibold hover:bg-slate-50 disabled:opacity-50">−</button>
                          <button disabled={busyId === item.id} onClick={() => void updateItem(item.id, { action: "increment" })} className="rounded-lg border border-line px-3 py-2 font-semibold hover:bg-slate-50 disabled:opacity-50">+</button>
                          <button disabled={busyId === item.id} onClick={() => void updateItem(item.id, { action: "mark_empty" })} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Tomt</button>
                          <button disabled={busyId === item.id} onClick={() => void updateItem(item.id, { action: "set_desired", desiredQuantity: item.quantity })} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-brand hover:bg-brand-soft disabled:opacity-50">Sett ønsket</button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted">Ingen lagerlinjer matcher filteret.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold">Bør fylles på nå</h2>
            <div className="mt-4 space-y-3">
              {restockItems.length ? restockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl bg-amber-50 p-3">
                  <div className="min-w-0">
                    {item.product ? (
                      <Link href={`/products/${item.product.id}`} className="truncate font-semibold text-brand hover:underline">{item.product.name}</Link>
                    ) : (
                      <p className="truncate font-semibold">Ukjent produkt</p>
                    )}
                    <p className="text-xs text-muted">{item.quantity} av {item.desired_quantity} stk · {item.location}</p>
                  </div>
                  <button onClick={() => void updateItem(item.id, { action: "increment" })} className="rounded-lg bg-white px-3 py-2 text-brand shadow-sm">+1</button>
                </div>
              )) : <p className="text-sm text-muted">Ingen akutte påfyll akkurat nå.</p>}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Ikke kjøp ennå</h2>
            <div className="mt-4 space-y-3">
              {doNotBuyItems.length ? doNotBuyItems.map((item) => (
                <div key={item.id} className="rounded-xl bg-emerald-50 p-3">
                  {item.product ? (
                    <Link href={`/products/${item.product.id}`} className="truncate font-semibold text-brand hover:underline">{item.product.name}</Link>
                  ) : (
                    <p className="truncate font-semibold">Ukjent produkt</p>
                  )}
                  <p className="text-xs text-muted">{item.quantity} av {item.desired_quantity} stk · {item.status}</p>
                </div>
              )) : <p className="text-sm text-muted">Ingen varer å holde igjen på ennå.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-slate-50 p-5 text-sm text-muted">
            <p className="font-semibold text-slate-800">Slik brukes lageret</p>
            <p className="mt-2">Anbefalinger og handlelister bruker faktisk beholdning mot ønsket nivå. Oppdater derfor lager når noe kjøpes, brukes opp eller går tomt.</p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
