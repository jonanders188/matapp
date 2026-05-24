"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { authFetch } from "@/lib/auth-fetch";

type Product = {
  id: string;
  ean: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  package_size: string | null;
  image_url?: string | null;
};

type GroupMember = {
  id: string;
  product_id: string;
  relationship_type: string;
  confidence: number | null;
  manually_confirmed: boolean | null;
  reason?: string | null;
  products: Product | null;
};

type ProductGroup = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
  description: string | null;
  status: string;
  product_group_members: GroupMember[];
};

type GroupPriceRow = {
  id: string;
  product_id: string;
  product: Product | null;
  store_code: string | null;
  store_name: string | null;
  price: number | null;
  unit_price: number | null;
  comparison_unit: string | null;
  package_quantity: number | null;
  package_unit: string | null;
  unit_price_source: string | null;
  observed_at: string | null;
  source: string | null;
};


const relationshipLabels: Record<string, string> = {
  same_product_different_package: "Samme vare, annen pakning",
  same_product_variant: "Variant",
  same_category_alternative: "Alternativ",
  not_comparable: "Ikke sammenlignbar"
};

function unitLabel(unit: string | null) {
  if (unit === "kg") return "kr/kg";
  if (unit === "l") return "kr/l";
  if (unit === "stk") return "kr/stk";
  return unit ?? "Ikke satt";
}

function percent(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  return `${Math.round(Number(value) * 100)}%`;
}

function productSubtitle(product: Product | null) {
  if (!product) return "";
  return [product.brand, product.category, product.package_size, product.ean].filter(Boolean).join(" · ");
}

function kroner(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  return new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

function dateLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("nb-NO");
}

function packageLabel(price: GroupPriceRow) {
  const quantity = price.package_quantity;
  const unit = price.package_unit;
  if (!quantity || !unit) return "";
  return `${quantity} ${unit}`;
}

export default function ProductGroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [groupId, setGroupId] = useState("");
  const [group, setGroup] = useState<ProductGroup | null>(null);
  const [form, setForm] = useState({ name: "", brand: "", category: "", comparison_unit: "kg", description: "" });
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Product[]>([]);
  const [prices, setPrices] = useState<GroupPriceRow[]>([]);
  const [cheapestPrice, setCheapestPrice] = useState<GroupPriceRow | null>(null);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [relationshipType, setRelationshipType] = useState("same_product_different_package");
  const [rememberAsNegative, setRememberAsNegative] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const eanCount = group?.product_group_members?.length ?? 0;
  const suggestedQuery = useMemo(() => group?.name ?? "", [group?.name]);

  useEffect(() => {
    params.then(({ id }) => setGroupId(id));
  }, [params]);

  useEffect(() => {
    if (groupId) loadGroup(groupId);
  }, [groupId]);

  async function loadGroup(id = groupId) {
    if (!id) return;
    setLoading(true);
    setError("");

    const response = await authFetch(`/api/admin/product-groups/${id}`);
    const payload = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente overordnet vare");
      return;
    }

    setGroup(payload.group);
    setForm({
      name: payload.group?.name ?? "",
      brand: payload.group?.brand ?? "",
      category: payload.group?.category ?? "",
      comparison_unit: payload.group?.comparison_unit ?? "kg",
      description: payload.group?.description ?? ""
    });

    await loadPrices(id);
  }

  async function loadPrices(id = groupId) {
    if (!id) return;
    setLoadingPrices(true);

    const response = await authFetch(`/api/admin/product-groups/${id}/prices`);
    const payload = await response.json().catch(() => ({}));
    setLoadingPrices(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente prisrangering");
      return;
    }

    setPrices(payload.prices ?? []);
    setCheapestPrice(payload.cheapest ?? null);
  }

  async function saveMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    const response = await authFetch(`/api/admin/product-groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });

    const payload = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke lagre overordnet vare");
      return;
    }

    setGroup(payload.group);
    setNotice("Overordnet vare ble oppdatert.");
    await loadPrices();
  }

  async function searchCandidates(searchQuery = query) {
    if (!groupId) return;
    setSearching(true);
    setError("");

    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    params.set("limit", "50");

    const response = await authFetch(`/api/admin/product-groups/${groupId}/candidates?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    setSearching(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke søke etter Forpakninger / Forpakning / EAN-varer");
      return;
    }

    setCandidates(payload.candidates ?? []);
  }

  async function addCandidate(productId: string) {
    setError("");
    setNotice("");

    const response = await authFetch(`/api/admin/product-groups/${groupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: productId,
        relationship_type: relationshipType,
        confidence: 1,
        reason: "Lagt til manuelt av System Admin."
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke legge til forpakning");
      return;
    }

    setNotice("Forpakning ble lagt til.");
    setCandidates((current) => current.filter((candidate) => candidate.id !== productId));
    await loadGroup();
    await loadPrices();
  }

  async function removeMember(memberId: string) {
    setError("");
    setNotice("");

    const response = await authFetch(`/api/admin/product-groups/${groupId}/members/${memberId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rememberAsNegative })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke ta forpakningen ut");
      return;
    }

    setNotice(`Forpakning ble tatt ut. ${payload.negativeMatchCount ?? 0} negative matcher ble lagret.`);
    await loadGroup();
    await loadPrices();
  }

  async function findMoreWithAi() {
    if (!groupId) return;
    setSearching(true);
    setError("");
    setNotice("");

    const response = await authFetch(`/api/admin/product-groups/${groupId}/ai-candidates`);
    const payload = await response.json().catch(() => ({}));
    setSearching(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke finne flere Forpakninger / Forpakning / EAN-varer");
      return;
    }

    setCandidates(payload.candidates ?? []);
    setNotice(`Fant ${payload.candidates?.length ?? 0} mulige Forpakninger / Forpakning / EAN-varer. Velg de som skal legges til.`);
  }

  return (
    <AppShell active="Systemadmin">
      <div className="space-y-6">
        <section className="rounded-3xl bg-gradient-to-br from-slate-900 to-emerald-900 p-6 text-white shadow-soft">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">System Admin</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold">{group?.name ?? "Overordnet vare"}</h1>
              <p className="mt-2 max-w-3xl text-white/80">
                Rediger overordnet vare og styr hvilke konkrete Forpakninger / Forpakning / EAN-varer som hører til.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/admin/product-groups" className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/30">
                Tilbake
              </a>
              <button
                type="button"
                onClick={findMoreWithAi}
                className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-900 shadow-soft"
              >
                Finn flere med AI
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        {notice ? <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-brand">{notice}</div> : null}

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard title="Forpakninger / Forpakning / EAN-varer" value={String(eanCount)} subtitle="Knyttet til overordnet vare" tone="green" />
          <StatCard title="Enhet" value={unitLabel(group?.comparison_unit ?? null)} subtitle="Brukes til sammenligning" tone="amber" />
          <StatCard title="Status" value={loading ? "Laster" : group?.status ?? "Ukjent"} subtitle="System Admin-data" tone="purple" />
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-bold">Metadata</h2>
          <form onSubmit={saveMetadata} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="text-sm font-semibold">
              Navn på overordnet vare
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required className="mt-1 w-full rounded-2xl border border-line px-3 py-2" />
            </label>
            <label className="text-sm font-semibold">
              Merke
              <input value={form.brand} onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value }))} className="mt-1 w-full rounded-2xl border border-line px-3 py-2" />
            </label>
            <label className="text-sm font-semibold">
              Kategori
              <input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="mt-1 w-full rounded-2xl border border-line px-3 py-2" />
            </label>
            <label className="text-sm font-semibold">
              Sammenlignes som
              <select value={form.comparison_unit} onChange={(event) => setForm((current) => ({ ...current, comparison_unit: event.target.value }))} className="mt-1 w-full rounded-2xl border border-line px-3 py-2">
                <option value="kg">kr/kg</option>
                <option value="l">kr/l</option>
                <option value="stk">kr/stk</option>
              </select>
            </label>
            <button type="submit" disabled={saving} className="self-end rounded-2xl bg-brand px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Lagrer..." : "Lagre"}
            </button>
            <label className="md:col-span-2 xl:col-span-5 text-sm font-semibold">
              Beskrivelse
              <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-2xl border border-line px-3 py-2" />
            </label>
          </form>
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-bold">Prisrangering for overordnet vare</h2>
              <p className="mt-1 text-sm text-muted">
                Viser billigste forpakning på tvers av EAN-varer, sortert på pris per enhet.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadPrices()}
              disabled={loadingPrices}
              className="rounded-2xl border border-line px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"
            >
              {loadingPrices ? "Henter..." : "Oppdater priser"}
            </button>
          </div>

          {cheapestPrice ? (
            <div className="mt-4 rounded-2xl bg-emerald-50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Billigst nå</p>
              <p className="mt-1 text-lg font-bold">{cheapestPrice.product?.name ?? cheapestPrice.product_id}</p>
              <p className="text-sm text-slate-700">
                {[cheapestPrice.store_name, cheapestPrice.product?.package_size || packageLabel(cheapestPrice)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-2 text-2xl font-black text-brand">
                {kroner(cheapestPrice.unit_price)} {unitLabel(cheapestPrice.comparison_unit)}
              </p>
              <p className="text-sm text-slate-700">
                Pakkepris {kroner(cheapestPrice.price)} kr
                {cheapestPrice.observed_at ? ` · observert ${dateLabel(cheapestPrice.observed_at)}` : ""}
              </p>
            </div>
          ) : (
            <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-muted">
              Ingen prisobservasjoner funnet ennå.
            </p>
          )}

          <div className="mt-4 grid gap-2">
            {prices.slice(0, 12).map((price) => (
              <div key={price.id} className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm md:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-semibold">{price.product?.name ?? price.product_id}</p>
                  <p className="text-muted">
                    {[price.store_name, price.product?.brand, price.product?.category, price.product?.package_size || packageLabel(price)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {[price.source, price.observed_at ? dateLabel(price.observed_at) : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-black text-brand">
                    {kroner(price.unit_price)} {unitLabel(price.comparison_unit)}
                  </p>
                  <p className="text-xs text-muted">Pakkepris {kroner(price.price)} kr</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-bold">Forpakninger / Forpakning / EAN-varer</h2>
              <p className="mt-1 text-sm text-muted">Dette er konkrete forpakninger med egen strekkode som hører til den overordnede varen.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={rememberAsNegative} onChange={(event) => setRememberAsNegative(event.target.checked)} />
              Husk uttak som negativ match
            </label>
          </div>

          <div className="mt-4 grid gap-2">
            {group?.product_group_members?.length ? group.product_group_members.map((member) => (
              <div key={member.id} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <div>
                  <p className="font-semibold">{member.products?.name ?? member.product_id}</p>
                  <p className="text-muted">{productSubtitle(member.products)}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {relationshipLabels[member.relationship_type] ?? member.relationship_type}
                    {member.confidence !== null ? ` · ${percent(member.confidence)}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => removeMember(member.id)} className="rounded-xl border border-line px-3 py-2 text-xs font-bold text-slate-700 hover:bg-white">
                  Ta ut forpakning
                </button>
              </div>
            )) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">Ingen Forpakninger / Forpakning / EAN-varer ennå.</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-bold">Legg til forpakning manuelt</h2>
          <p className="mt-1 text-sm text-muted">Søk i globale produkter og knytt riktig forpakning/EAN-vare til denne overordnede varen.</p>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={suggestedQuery || "Søk etter produkt, EAN, merke eller kategori"}
              className="rounded-2xl border border-line px-4 py-3 text-sm"
            />
            <select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)} className="rounded-2xl border border-line px-4 py-3 text-sm">
              <option value="same_product_different_package">Samme vare, annen pakning</option>
              <option value="same_product_variant">Variant</option>
              <option value="same_category_alternative">Alternativ</option>
            </select>
            <button type="button" onClick={() => searchCandidates(query || suggestedQuery)} disabled={searching} className="rounded-2xl bg-brand px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
              {searching ? "Søker..." : "Søk"}
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {candidates.length ? candidates.map((candidate) => (
              <div key={candidate.id} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <div>
                  <p className="font-semibold">{candidate.name}</p>
                  <p className="text-muted">{productSubtitle(candidate)}</p>
                </div>
                <button type="button" onClick={() => addCandidate(candidate.id)} className="rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white">
                  Legg til
                </button>
              </div>
            )) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">Ingen søketreff vist ennå.</p>}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
