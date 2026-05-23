"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { cx } from "@/lib/utils";

type MealSuggestion = {
  id: string;
  title: string;
  type: "middag" | "lunsj" | "basis" | "restemat";
  timeMinutes: number;
  portions: number;
  score: number;
  confidence: "hoy" | "middels" | "lav";
  availableIngredients: string[];
  missingIngredients: string[];
  useUpIngredients: string[];
  reason: string;
  steps: string[];
  shoppingHint: string;
};

type MealsPayload = {
  stats: {
    inventoryItems: number;
    highConfidence: number;
    useUpMeals: number;
    noExtraShopping: number;
  };
  suggestions: MealSuggestion[];
};

const confidenceLabels = {
  hoy: "Høy match",
  middels: "Middels match",
  lav: "Lav match"
};

const confidenceClasses = {
  hoy: "bg-emerald-50 text-brand",
  middels: "bg-amber-50 text-amber-700",
  lav: "bg-slate-100 text-slate-600"
};

function mealTypeLabel(type: MealSuggestion["type"]) {
  if (type === "restemat") return "Restemat";
  if (type === "basis") return "Basis";
  if (type === "lunsj") return "Lunsj";
  return "Middag";
}

export default function MealsPage() {
  const [payload, setPayload] = useState<MealsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string>("alle");

  async function loadMeals() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/meals/suggest", { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke hente middagsforslag");
      setPayload(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente middagsforslag");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeals().catch(() => undefined);
  }, []);

  const suggestions = payload?.suggestions ?? [];
  const filtered = useMemo(() => {
    if (activeType === "alle") return suggestions;
    return suggestions.filter((suggestion) => suggestion.type === activeType);
  }, [activeType, suggestions]);

  return (
    <AppShell active="Middager">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="page-heading">Middagsforslag</h1>
          <p className="page-subtitle">Forslag basert på lager, fryser og varer som bør brukes opp.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/inventory" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Lager</a>
          <button onClick={loadMeals} disabled={loading} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? "Henter..." : "Oppdater forslag"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <StatCard title="Lagerlinjer analysert" value={String(payload?.stats.inventoryItems ?? 0)} subtitle="Fra lager og fryser" />
        <StatCard title="Sterke middagsforslag" value={String(payload?.stats.highConfidence ?? 0)} subtitle="Høy match med lager" tone="blue" />
        <StatCard title="Bruk-opp-retter" value={String(payload?.stats.useUpMeals ?? 0)} subtitle="Reduserer matsvinn" tone="amber" />
        <StatCard title="Uten ekstra handling" value={String(payload?.stats.noExtraShopping ?? 0)} subtitle="Alle nøkkelvarer finnes" tone="purple" />
      </div>

      {error ? <p className="mt-6 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          ["alle", "Alle"],
          ["middag", "Middager"],
          ["restemat", "Restemat"],
          ["basis", "Basis"],
          ["lunsj", "Lunsj"]
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveType(key)}
            className={cx(
              "rounded-full border border-line px-4 py-2 text-sm font-medium",
              activeType === key ? "bg-brand text-white" : "bg-white text-slate-700"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid gap-5">
          {filtered.map((suggestion) => (
            <article key={suggestion.id} className="card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{suggestion.title}</h2>
                    <span className={cx("pill", confidenceClasses[suggestion.confidence])}>{confidenceLabels[suggestion.confidence]}</span>
                    <span className="pill bg-slate-100 text-slate-600">{mealTypeLabel(suggestion.type)}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">{suggestion.reason}</p>
                </div>
                <div className="text-right text-sm text-muted">
                  <p className="text-2xl font-bold text-brand">{suggestion.score}</p>
                  <p>score</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl bg-emerald-50 p-4">
                  <p className="font-semibold text-brand">Dere har</p>
                  <p className="page-subtitle">{suggestion.availableIngredients.length ? suggestion.availableIngredients.join(", ") : "Ingen nøkkelvarer funnet"}</p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4">
                  <p className="font-semibold text-amber-800">Mangler / vurder</p>
                  <p className="page-subtitle">{suggestion.missingIngredients.length ? suggestion.missingIngredients.join(", ") : "Ingen nøkkelvarer mangler"}</p>
                </div>
                <div className="rounded-2xl bg-sky-50 p-4">
                  <p className="font-semibold text-sky-800">Bruk opp</p>
                  <p className="page-subtitle">{suggestion.useUpIngredients.length ? suggestion.useUpIngredients.join(", ") : "Ingen spesifikke bruk-opp-varer"}</p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div>
                  <p className="text-sm font-semibold">Fremgangsmåte</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
                    {suggestion.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </div>
                <div className="rounded-2xl border border-line p-4 text-sm">
                  <p className="font-semibold">Plan</p>
                  <p className="page-subtitle">⏱ {suggestion.timeMinutes} min</p>
                  <p className="text-muted">🍽 {suggestion.portions} porsjoner</p>
                  <p className="mt-3 text-muted">{suggestion.shoppingHint}</p>
                </div>
              </div>
            </article>
          ))}

          {!loading && filtered.length === 0 ? (
            <div className="card p-8 text-center text-muted">Ingen middagsforslag funnet. Legg inn flere lagerlinjer eller oppdater lageret.</div>
          ) : null}
        </section>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold">Slik bruker du siden</h2>
            <div className="mt-4 space-y-3 text-sm text-muted">
              <p><b className="text-slate-900">Høy match</b> betyr at de viktigste varene finnes i lageret.</p>
              <p><b className="text-slate-900">Mangler / vurder</b> kan legges til i handlelisten hvis retten skal planlegges.</p>
              <p><b className="text-slate-900">Bruk opp</b> peker på varer som kan redusere matsvinn eller overfylt lager.</p>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Neste naturlige steg</h2>
            <div className="mt-4 space-y-3 text-sm text-muted">
              <p>1. Velg 3–5 middager.</p>
              <p>2. Legg manglende nøkkelvarer i handlelisten.</p>
              <p>3. Oppdater lageret etter middag.</p>
              <p>4. Bruk fryseren før nye proteiner kjøpes.</p>
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
