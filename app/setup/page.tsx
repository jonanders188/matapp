"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { authFetch } from "@/lib/auth-fetch";

const steps = [
  {
    key: "status",
    title: "Sjekk miljø og database",
    description: "Kontrollerer Supabase, Kassalapp og at tabellene finnes.",
    method: "GET",
    url: "/api/bootstrap/status"
  },
  {
    key: "import",
    title: "Importer topp 50 produkter",
    description: "Oppretter produktmaster, lagerlinjer og første prisobservasjoner.",
    method: "POST",
    url: "/api/import/top-products",
    body: { dryRun: false }
  },
  {
    key: "sync",
    title: "Synk alle priser",
    description: "Henter oppdaterte priser fra Kassalapp for lagrede produkter.",
    method: "POST",
    url: "/api/products/sync-prices"
  },
  {
    key: "recommendations",
    title: "Generer anbefalinger",
    description: "Lager kjøp/vent/hamstre/anbefalinger basert på pris og lager.",
    method: "POST",
    url: "/api/recommendations/generate"
  },
  {
    key: "shopping-list",
    title: "Generer handleliste",
    description: "Lager en praktisk handleliste fra anbefalingene, med maks to butikker.",
    method: "POST",
    url: "/api/shopping-list/generate",
    body: { maxStores: 2 }
  }
] as const;

type StepKey = (typeof steps)[number]["key"];
type StepState = "idle" | "running" | "ok" | "error";

type StepResult = {
  state: StepState;
  payload?: unknown;
  error?: string;
};

function stringifyPayload(payload: unknown) {
  if (!payload) return "";
  try {
    return JSON.stringify(payload, null, 2).slice(0, 1200);
  } catch {
    return String(payload).slice(0, 1200);
  }
}

function stateLabel(state: StepState) {
  if (state === "running") return "Kjører";
  if (state === "ok") return "OK";
  if (state === "error") return "Feil";
  return "Ikke kjørt";
}

function stateClass(state: StepState) {
  if (state === "running") return "bg-sky-50 text-sky-700";
  if (state === "ok") return "bg-emerald-50 text-brand";
  if (state === "error") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

export default function SetupPage() {
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [adminSecret, setAdminSecret] = useState("");

  async function runStep(step: (typeof steps)[number]) {
    setResults((prev) => ({ ...prev, [step.key]: { state: "running" } }));

    try {
      const response = await authFetch(step.url, {
        method: step.method,
        headers: step.method === "POST"
          ? { "Content-Type": "application/json" }
          : undefined,
        body: step.method === "POST" ? JSON.stringify("body" in step ? step.body : {}) : undefined
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? `${response.status} ${response.statusText}`);
      }

      setResults((prev) => ({ ...prev, [step.key]: { state: "ok", payload } }));
      return true;
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [step.key]: { state: "error", error: error instanceof Error ? error.message : "Ukjent feil" }
      }));
      return false;
    }
  }

  async function runAll() {
    setRunningAll(true);
    for (const step of steps) {
      const ok = await runStep(step);
      if (!ok) break;
    }
    setRunningAll(false);
  }

  useEffect(() => {
    const savedSecret = window.localStorage.getItem("husholdningspilot-admin-secret") ?? "";
    setAdminSecret(savedSecret);
    runStep(steps[0]);
  }, []);

  function updateAdminSecret(value: string) {
    setAdminSecret(value);
    window.localStorage.setItem("husholdningspilot-admin-secret", value);
  }

  const stats = useMemo(() => {
    const values = Object.values(results);
    return {
      ok: values.filter((result) => result.state === "ok").length,
      error: values.filter((result) => result.state === "error").length,
      running: values.filter((result) => result.state === "running").length,
      total: steps.length
    };
  }, [results]);

  const statusPayload = results.status?.payload as
    | { tables?: Array<{ table: string; ok: boolean; count: number; error?: string | null }>; household?: { name?: string } }
    | undefined;

  return (
    <AppShell active="Oppsett">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">Oppsett og oppstart</h1>
          <p className="mt-2 text-muted">Kjør hele MVP-flyten i riktig rekkefølge og sjekk at alt er klart.</p>
          <p className="mt-2 text-sm text-muted">I produksjon må tunge steg ha ADMIN_API_SECRET eller CRON_SECRET.</p>
        </div>
        <div className="flex gap-3">
          <a href="/products" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Produkter</a>
          <a href="/recommendations" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Anbefalinger</a>
          <a href="/shopping-list" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Handleliste</a>
          <input
            value={adminSecret}
            onChange={(event) => updateAdminSecret(event.target.value)}
            placeholder="Admin-secret ved deploy"
            type="password"
            className="w-56 rounded-xl border border-line px-4 py-2 text-sm"
          />
          <button onClick={runAll} disabled={runningAll} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {runningAll ? "Kjører..." : "Kjør full oppstart"}
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-4 gap-5">
        <StatCard title="Steg fullført" value={`${stats.ok}/${stats.total}`} subtitle="Oppstartsflyt" />
        <StatCard title="Feil" value={String(stats.error)} subtitle="Må rettes før deploy" tone={stats.error ? "red" : "green"} />
        <StatCard title="Kjører nå" value={String(stats.running)} subtitle="Aktive jobber" tone="blue" />
        <StatCard title="Husholdning" value={statusPayload?.household?.name ?? "-"} subtitle="Standard household" tone="amber" />
      </div>

      <div className="mt-8 grid grid-cols-[1fr_380px] gap-6">
        <section className="card overflow-hidden">
          <div className="border-b border-line p-5">
            <h2 className="text-lg font-semibold">Oppstartssteg</h2>
            <p className="text-sm text-muted">Kjør ett og ett steg ved feilsøking, eller alt samlet når oppsettet er stabilt.</p>
          </div>
          <div className="divide-y divide-line">
            {steps.map((step, index) => {
              const result = results[step.key] ?? { state: "idle" as StepState };
              return (
                <article key={step.key} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">{index + 1}</span>
                        <h3 className="text-lg font-semibold">{step.title}</h3>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stateClass(result.state)}`}>{stateLabel(result.state)}</span>
                      </div>
                      <p className="mt-2 text-sm text-muted">{step.description}</p>
                      {result.error ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{result.error}</p> : null}
                      {result.payload ? (
                        <details className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                          <summary className="cursor-pointer font-medium text-slate-800">Vis respons</summary>
                          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{stringifyPayload(result.payload)}</pre>
                        </details>
                      ) : null}
                    </div>
                    <button
                      onClick={() => runStep(step)}
                      disabled={result.state === "running" || runningAll}
                      className="shrink-0 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-brand disabled:opacity-50"
                    >
                      {result.state === "running" ? "Kjører..." : "Kjør"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold">Database-status</h2>
            <div className="mt-4 space-y-3">
              {statusPayload?.tables?.map((table) => (
                <div key={table.table} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium">{table.table}</span>
                  <span className={table.ok ? "text-brand" : "text-rose-700"}>{table.ok ? `${table.count} rader` : table.error}</span>
                </div>
              )) ?? <p className="text-sm text-muted">Kjør statussjekk for å se tabeller.</p>}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Deploy-sjekkliste</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>Kjør alle SQL-patcher i Supabase.</li>
              <li>Sett miljøvariabler i Vercel, inkludert ADMIN_API_SECRET eller CRON_SECRET.</li>
              <li>Kjør full oppstart lokalt.</li>
              <li>Kjør <code>npm run build</code> før deploy.</li>
              <li>Test /setup, /products, /recommendations og /shopping-list i Vercel.</li>
            </ol>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Nyttige lenker</h2>
            <div className="mt-4 grid gap-2 text-sm">
              <a className="rounded-xl bg-slate-50 px-3 py-2 text-brand" href="/api/health">/api/health</a>
              <a className="rounded-xl bg-slate-50 px-3 py-2 text-brand" href="/api/bootstrap/status">/api/bootstrap/status</a>
              <a className="rounded-xl bg-slate-50 px-3 py-2 text-brand" href="/inventory">Lager</a>
              <a className="rounded-xl bg-slate-50 px-3 py-2 text-brand" href="/shopping-list">Smart handleliste</a>
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
