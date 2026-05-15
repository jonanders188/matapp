"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";

type Recommendation = {
  id?: string;
  product_id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  action: "buy" | "wait" | "stock_up" | "use_up" | "switch_brand";
  action_label: string;
  store_name: string | null;
  price: number | null;
  target_price: number | null;
  estimated_saving: number | null;
  current_stock?: number | null;
  desired_stock?: number | null;
  reason: string;
  valid_until?: string | null;
  created_at?: string | null;
};

const actionStyles: Record<Recommendation["action"], string> = {
  buy: "bg-emerald-50 text-brand",
  stock_up: "bg-violet-50 text-violet-700",
  wait: "bg-amber-50 text-amber-700",
  use_up: "bg-sky-50 text-sky-700",
  switch_brand: "bg-rose-50 text-rose-700"
};

function shortDate(value?: string | null) {
  return value ? value.slice(0, 10) : "-";
}

function sumSavings(items: Recommendation[]) {
  return items.reduce((sum, item) => sum + (item.estimated_saving ?? 0), 0);
}

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadRecommendations() {
    const response = await authFetch("/api/recommendations", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente anbefalinger");
      return;
    }
    setRecommendations(payload?.data ?? []);
  }

  async function generateRecommendations() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch("/api/recommendations/generate", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kunne ikke generere anbefalinger");
      setRecommendations(payload?.data ?? []);
      setMessage(`Genererte ${payload?.count ?? 0} anbefalinger basert på lager, målpris og prisobservasjoner.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke generere anbefalinger");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRecommendations().catch(() => undefined);
  }, []);

  const grouped = useMemo(() => {
    return recommendations.reduce<Record<string, Recommendation[]>>((acc, recommendation) => {
      const key = recommendation.action;
      acc[key] = acc[key] ?? [];
      acc[key].push(recommendation);
      return acc;
    }, {});
  }, [recommendations]);

  const buyCount = (grouped.buy?.length ?? 0) + (grouped.stock_up?.length ?? 0);
  const waitCount = grouped.wait?.length ?? 0;
  const useUpCount = grouped.use_up?.length ?? 0;
  const savings = sumSavings(recommendations);

  return (
    <AppShell active="Anbefalinger">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold">Anbefalinger</h1>
          <p className="mt-1 text-muted">Kjøp, vent og bruk opp basert på målpris, lager og Kassalapp-priser.</p>
        </div>
        <div className="flex gap-2">
          <a href="/products" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Produkter</a>
          <a href="/shopping-list" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Handleliste</a>
          <button
            onClick={generateRecommendations}
            disabled={loading}
            className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Genererer..." : "Generer anbefalinger"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-5">
        <StatCard title="Anbefalinger" value={String(recommendations.length)} subtitle="Aktive forslag" />
        <StatCard title="Kjøp/hamstre" value={String(buyCount)} subtitle="Varer verdt å kjøpe" tone="blue" />
        <StatCard title="Vent" value={String(waitCount)} subtitle="Ikke gode nok priser" tone="amber" />
        <StatCard title="Mulig sparing" value={kr(savings)} subtitle={`${useUpCount} bruk-opp forslag`} tone="purple" />
      </div>

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <div className="mt-6 grid grid-cols-[1fr_360px] gap-5">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line p-5">
            <div>
              <h2 className="text-lg font-semibold">Prioritert liste</h2>
              <p className="text-sm text-muted">Forslagene regenereres når prisdata eller lager endres.</p>
            </div>
            <button onClick={loadRecommendations} className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-brand">Oppdater</button>
          </div>

          <div className="divide-y divide-line">
            {recommendations.map((recommendation) => (
              <article key={`${recommendation.id ?? recommendation.product_id}-${recommendation.action}`} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50">
                      {recommendation.image_url ? (
                        <img
                          src={recommendation.image_url}
                          alt=""
                          className="h-full w-full object-contain"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`pill ${actionStyles[recommendation.action] ?? "bg-slate-50 text-slate-700"}`}>{recommendation.action_label}</span>
                        {recommendation.category ? <span className="pill bg-slate-50 text-muted">{recommendation.category}</span> : null}
                      </div>
                      <Link href={`/products/${recommendation.product_id}`} className="mt-3 block text-lg font-semibold text-brand hover:underline">{recommendation.product_name}</Link>
                      <p className="mt-1 text-sm text-muted">{recommendation.reason}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xl font-bold text-brand">{kr(recommendation.price)}</p>
                    <p className="text-sm text-muted">{recommendation.store_name ?? "Ingen butikk"}</p>
                    {recommendation.estimated_saving ? <p className="mt-2 text-xs text-brand">Sparer ca. {kr(recommendation.estimated_saving)}</p> : null}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-muted">Målpris</p><p className="font-semibold">{kr(recommendation.target_price)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-muted">Lager</p><p className="font-semibold">{recommendation.current_stock ?? "-"} / {recommendation.desired_stock ?? "-"}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-muted">Gyldig til</p><p className="font-semibold">{shortDate(recommendation.valid_until)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-muted">Merke</p><p className="truncate font-semibold">{recommendation.brand ?? "-"}</p></div>
                </div>
              </article>
            ))}
            {!recommendations.length ? (
              <div className="p-10 text-center text-muted">
                Ingen anbefalinger ennå. Trykk <b>Generer anbefalinger</b> etter at du har importert produkter og synket priser.
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold">Slik tolkes forslagene</h2>
            <div className="mt-4 space-y-3 text-sm text-muted">
              <p><b className="text-slate-900">Kjøp nå</b> betyr lavt lager og god pris.</p>
              <p><b className="text-slate-900">Hamstre</b> brukes for basisvarer/frys når prisen er tydelig under målpris.</p>
              <p><b className="text-slate-900">Vent</b> betyr at prisen er over målpris og lageret er OK.</p>
              <p><b className="text-slate-900">Bruk opp</b> betyr at lageret er høyere enn ønsket nivå.</p>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Neste steg</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>Legg til produkter i basisutvalget på Produkter-siden.</li>
              <li>Synk basispriser.</li>
              <li>Juster lager og ønsket nivå.</li>
              <li>Generer anbefalinger på nytt.</li>
            </ol>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
