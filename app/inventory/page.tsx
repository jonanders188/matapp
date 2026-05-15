"use client";

import Link from "next/link";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";

type InventoryStatus = "På lager" | "Lavt lager" | "Tomt" | "Overfylt";
type SortKey = "product" | "quantity" | "desired" | "location" | "price" | "store" | "updated";
type SortDirection = "asc" | "desc";

type InventoryItem = {
  id: string;
  product_id: string;
  location: string | null;
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
  latest_unit_price?: number | null;
  latest_store: string | null;
  latest_store_key?: string | null;
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

function toNumberInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function parseInputNumber(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100) / 100);
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

function sortValue(item: InventoryItem, key: SortKey) {
  if (key === "product") return item.product?.name ?? "";
  if (key === "quantity") return item.quantity ?? 0;
  if (key === "desired") return item.desired_quantity ?? 0;
  if (key === "location") return item.location ?? "";
  if (key === "price") return item.latest_price ?? Number.POSITIVE_INFINITY;
  if (key === "store") return item.latest_store ?? "";
  return item.updated_at ? new Date(item.updated_at).getTime() : 0;
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stats, setStats] = useState<InventoryStats>({ total: 0, low: 0, empty: 0, overstocked: 0, needsRestock: 0 });
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("product");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [error, setError] = useState<string | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    return () => {
      Object.values(debounceTimers.current).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  async function updateItem(id: string, body: Record<string, unknown>) {
    setSavingIds((current) => new Set(current).add(id));
    setError(null);

    try {
      const response = await authFetch(`/api/inventory/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Kunne ikke oppdatere lager");
        await loadInventory();
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oppdatere lager");
      await loadInventory();
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function patchLocalItem(id: string, updates: Partial<InventoryItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }

  function debouncedUpdate(id: string, body: Record<string, unknown>) {
    if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id]);
    debounceTimers.current[id] = setTimeout(() => {
      void updateItem(id, body);
    }, 450);
  }

  function setSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "updated" || nextKey === "price" ? "desc" : "asc");
  }

  function sortLabel(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <button type="button" onClick={() => setSort(key)} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
        {label}
        <span className="text-[10px] text-slate-400">{active ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    );
  }

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = items.filter((item) => {
      const haystack = `${item.product?.name ?? ""} ${item.product?.brand ?? ""} ${item.product?.category ?? ""} ${item.location ?? ""} ${item.latest_store ?? ""}`.toLowerCase();
      return !normalizedQuery || haystack.includes(normalizedQuery);
    });

    return [...matches].sort((a, b) => {
      const aValue = sortValue(a, sortKey);
      const bValue = sortValue(b, sortKey);
      const direction = sortDirection === "asc" ? 1 : -1;

      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * direction;
      }

      return String(aValue).localeCompare(String(bValue), "nb") * direction;
    });
  }, [items, query, sortDirection, sortKey]);

  return (
    <AppShell active="Lager">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-heading">Lager</h1>
          <p className="page-subtitle">Hele basisutvalget vises her. Endre beholdning og ønsket behov direkte i tabellen.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button onClick={() => void loadInventory()} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Oppdater lager
          </button>
          <a href="/products" className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
            Legg til produkter
          </a>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-4">
        <StatCard title="Basisvarer" value={String(stats.total)} subtitle="Alle varer i basisutvalget" />
        <StatCard title="Lavt lager" value={String(stats.low)} subtitle="Under ønsket nivå" tone="amber" />
        <StatCard title="Tomt" value={String(stats.empty)} subtitle="Bør fylles på" tone="red" />
        <StatCard title="Trenger påfyll" value={String(stats.needsRestock)} subtitle="Tomt eller lavt" tone="purple" />
      </div>

      {error ? <div className="mt-5 rounded-2xl bg-rose-50 p-4 font-medium text-rose-700">{error}</div> : null}

      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Søk etter produkt, merke, butikk eller sted..."
            className="min-w-[260px] flex-1 rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
          />
          <p className="text-sm text-muted">{filtered.length} av {items.length} basisvarer</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="p-4">{sortLabel("product", "Produkt")}</th>
                <th>{sortLabel("quantity", "På lager")}</th>
                <th>{sortLabel("desired", "Ønsket behov")}</th>
                <th>{sortLabel("location", "Sted")}</th>
                <th>{sortLabel("price", "Siste pris")}</th>
                <th>{sortLabel("store", "Butikk")}</th>
                <th className="pr-4">{sortLabel("updated", "Oppdatert")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted">Henter basisutvalg...</td>
                </tr>
              ) : filtered.length ? (
                filtered.map((item) => {
                  const saving = savingIds.has(item.id);

                  return (
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
                            <p className="text-xs text-muted">{item.product?.brand ?? item.product?.category ?? "Basisvare"}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={toNumberInput(item.quantity)}
                          onChange={(event) => {
                            const quantity = parseInputNumber(event.target.value);
                            patchLocalItem(item.id, { quantity });
                            debouncedUpdate(item.id, { action: "set_quantity", quantity });
                          }}
                          className="w-24 rounded-xl border border-line px-3 py-2 text-sm font-semibold outline-none focus:border-brand disabled:opacity-60"
                          disabled={saving}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={toNumberInput(item.desired_quantity)}
                          onChange={(event) => {
                            const desiredQuantity = parseInputNumber(event.target.value);
                            patchLocalItem(item.id, { desired_quantity: desiredQuantity });
                            debouncedUpdate(item.id, { action: "set_desired", desiredQuantity });
                          }}
                          className="w-28 rounded-xl border border-line px-3 py-2 text-sm font-semibold outline-none focus:border-brand disabled:opacity-60"
                          disabled={saving}
                        />
                      </td>
                      <td>
                        <input
                          value={item.location ?? ""}
                          onChange={(event) => {
                            const location = event.target.value;
                            patchLocalItem(item.id, { location });
                            debouncedUpdate(item.id, { action: "set_location", location });
                          }}
                          className="w-32 rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
                          disabled={saving}
                        />
                      </td>
                      <td>
                        <p className="font-semibold">{money(item.latest_price)}</p>
                        <p className="text-xs text-muted">{item.price_observation_count ? `${item.price_observation_count} prisobservasjoner` : "Ingen aktiv pris"}</p>
                      </td>
                      <td>
                        <p className="font-semibold">{item.latest_store ?? "-"}</p>
                        <p className="text-xs text-muted">{shortDate(item.latest_observed_at)}</p>
                      </td>
                      <td className="pr-4 text-xs text-muted">
                        {saving ? "Lagrer..." : shortDate(item.updated_at)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted">Ingen basisvarer matcher søket.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
