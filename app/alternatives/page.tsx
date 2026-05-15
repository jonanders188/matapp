"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";

type Alternative = {
  id: string;
  product_id: string;
  alternative_name: string;
  alternative_brand: string | null;
  alternative_ean: string | null;
  alternative_image_url: string | null;
  alternative_store_name: string | null;
  alternative_price: number | null;
  alternative_unit_price: number | null;
  confidence: number | null;
  estimated_saving: number | null;
  status: "candidate" | "testing" | "accepted" | "rejected";
  reason: string | null;
  updated_at: string | null;
  product: {
    id: string;
    name: string;
    brand: string | null;
    category: string | null;
    image_url: string | null;
    target_price: number | null;
  } | null;
};

function statusLabel(status: Alternative["status"]) {
  switch (status) {
    case "accepted":
      return "Godkjent";
    case "testing":
      return "Testes";
    case "rejected":
      return "Avvist";
    default:
      return "Kandidat";
  }
}

function statusClass(status: Alternative["status"]) {
  switch (status) {
    case "accepted":
      return "bg-emerald-50 text-brand";
    case "testing":
      return "bg-sky-50 text-sky-700";
    case "rejected":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-amber-50 text-amber-700";
  }
}

export default function AlternativesPage() {
  const [items, setItems] = useState<Alternative[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const response = await authFetch("/api/alternatives", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    setLoading(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente alternativer");
      return;
    }

    setItems(payload?.data ?? []);
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    setMessage(null);
    const response = await authFetch("/api/alternatives/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 })
    });
    const payload = await response.json().catch(() => null);
    setGenerating(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke generere alternativer");
      return;
    }

    setMessage(`Generert: ${payload?.createdOrUpdated ?? 0} alternativer, ${payload?.skipped?.length ?? 0} hoppet over, ${payload?.errors?.length ?? 0} feil.`);
    await load();
  }

  async function updateStatus(id: string, status: Alternative["status"]) {
    setError(null);
    const response = await authFetch(`/api/alternatives/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke oppdatere status");
      return;
    }

    setItems((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const stats = useMemo(() => {
    const accepted = items.filter((item) => item.status === "accepted").length;
    const testing = items.filter((item) => item.status === "testing").length;
    const candidates = items.filter((item) => item.status === "candidate").length;
    const potentialSaving = items.reduce((sum, item) => sum + Math.max(Number(item.estimated_saving ?? 0), 0), 0);
    return { accepted, testing, candidates, potentialSaving };
  }, [items]);

  return (
    <AppShell active="Alternativer">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold">Alternativer og billigmerker</h1>
          <p className="mt-1 text-muted">Finn First Price, Eldorado og andre rimeligere alternativer til varene dere allerede kjøper.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Oppdater</button>
          <button onClick={generate} disabled={generating} className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {generating ? "Genererer..." : "Finn alternativer"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-5">
        <StatCard title="Kandidater" value={String(stats.candidates)} subtitle="Må vurderes" tone="amber" />
        <StatCard title="Til testing" value={String(stats.testing)} subtitle="Kjøp og smakstest" tone="blue" />
        <StatCard title="Godkjente" value={String(stats.accepted)} subtitle="Kan brukes fast" />
        <StatCard title="Mulig sparing" value={kr(stats.potentialSaving)} subtitle="Basert på siste pris" tone="purple" />
      </div>

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <section className="card mt-6 overflow-hidden">
        <div className="border-b border-line p-5">
          <h2 className="text-lg font-semibold">Foreslåtte bytter</h2>
          <p className="mt-1 text-sm text-muted">Godkjenn bare alternativer dere faktisk liker. Bruk “Testes” for blindtest i husholdningen.</p>
        </div>

        {loading ? <div className="p-10 text-center text-muted">Henter alternativer...</div> : null}

        {!loading && !items.length ? (
          <div className="p-10 text-center text-muted">
            Ingen alternativer ennå. Trykk <span className="font-semibold text-slate-700">Finn alternativer</span> for å analysere produktlisten.
          </div>
        ) : null}

        {!loading && items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Bytt fra</th>
                  <th className="px-4 py-3">Alternativ</th>
                  <th className="px-4 py-3">Pris</th>
                  <th className="px-4 py-3">Sparing</th>
                  <th className="px-4 py-3">Trygghet</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Handling</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 align-top">
                      {item.product ? (
                            <Link href={`/products/${item.product.id}`} className="font-semibold text-brand hover:underline">{item.product.name}</Link>
                          ) : (
                            <p className="font-semibold">Ukjent produkt</p>
                          )}
                      <p className="text-xs text-muted">{item.product?.brand ?? "Ukjent merke"}</p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50">
                          {item.alternative_image_url ? <img src={item.alternative_image_url} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
                        </div>
                        <div>
                          <p className="font-semibold">{item.alternative_name}</p>
                          <p className="text-xs text-muted">{item.alternative_brand ?? "Ukjent merke"} · {item.alternative_store_name ?? "Ukjent butikk"}</p>
                          {item.reason ? <p className="mt-1 max-w-md text-xs text-muted">{item.reason}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="font-semibold">{kr(item.alternative_price)}</p>
                      {item.alternative_unit_price ? <p className="text-xs text-muted">{kr(item.alternative_unit_price)} per enhet</p> : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={Number(item.estimated_saving ?? 0) > 0 ? "font-semibold text-brand" : "text-muted"}>{kr(item.estimated_saving)}</span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(Number(item.confidence ?? 0) * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted">{Math.round(Number(item.confidence ?? 0) * 100)} %</p>
                    </td>
                    <td className="px-4 py-3 align-top"><span className={`pill ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => updateStatus(item.id, "testing")} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium">Test</button>
                        <button onClick={() => updateStatus(item.id, "accepted")} className="rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white">Godkjenn</button>
                        <button onClick={() => updateStatus(item.id, "rejected")} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-rose-700">Avvis</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
