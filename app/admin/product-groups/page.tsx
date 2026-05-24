"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { authFetch } from "@/lib/auth-fetch";

type ProductInMember = {
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
  products: ProductInMember | null;
};

type ProductGroup = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
  description: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  product_group_members: GroupMember[];
};

type SuggestionMember = {
  id: string;
  product_id: string;
  relationship_type: string;
  confidence: number | null;
  reason: string | null;
  products: ProductInMember | null;
};

type ProductGroupSuggestion = {
  id: string;
  status: string;
  suggested_group_name: string;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
  confidence: number | null;
  reason: string | null;
  created_at: string | null;
  product_group_suggestion_members: SuggestionMember[];
};

type GroupsPayload = {
  groups: ProductGroup[];
};

type SuggestionsPayload = {
  suggestions: ProductGroupSuggestion[];
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

export default function ProductGroupsAdminPage() {
  const [data, setData] = useState<GroupsPayload | null>(null);
  const [suggestionsData, setSuggestionsData] = useState<SuggestionsPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [targetQuery, setTargetQuery] = useState("");
  const [ignoreNegativeMatches, setIgnoreNegativeMatches] = useState(false);
  const [rememberRemovedMembers, setRememberRemovedMembers] = useState(true);
  const [rememberRejectedPairs, setRememberRejectedPairs] = useState(true);
  const [selectedSuggestionMembers, setSelectedSuggestionMembers] = useState<Record<string, string[]>>({});
  const [form, setForm] = useState({
    name: "",
    brand: "",
    category: "",
    comparison_unit: "kg",
    description: ""
  });

  const groups = data?.groups ?? [];
  const suggestions = suggestionsData?.suggestions ?? [];
  const memberCount = useMemo(
    () => groups.reduce((sum, group) => sum + (group.product_group_members?.length ?? 0), 0),
    [groups]
  );

  async function loadGroups() {
    const response = await authFetch("/api/admin/product-groups");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? "Kunne ikke hente overordnede varer");
    }
    setData(payload);
  }

  async function loadSuggestions() {
    const response = await authFetch("/api/admin/product-groups/suggestions?status=pending");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? "Kunne ikke hente AI-forslag");
    }
    setSuggestionsData(payload);
    setSelectedSuggestionMembers((current) => {
      const next = { ...current };
      for (const suggestion of (payload.suggestions ?? []) as ProductGroupSuggestion[]) {
        if (!next[suggestion.id]) {
          next[suggestion.id] = (suggestion.product_group_suggestion_members ?? [])
            .filter((member) => member.relationship_type !== "not_comparable")
            .map((member) => member.id);
        }
      }
      return next;
    });
  }

  async function load() {
    setError("");
    try {
      await Promise.all([loadGroups(), loadSuggestions()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Kunne ikke laste systemadmin-data");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    const response = await authFetch("/api/admin/product-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });

    const payload = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke opprette overordnet vare");
      return;
    }

    setForm({ name: "", brand: "", category: "", comparison_unit: "kg", description: "" });
    setNotice("Overordnet vare ble opprettet.");
    await load();
  }

  async function generateSuggestions() {
    setGenerating(true);
    setError("");
    setNotice("");

    const response = await authFetch("/api/admin/product-groups/suggestions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        onlyUngrouped: true,
        limit: targetQuery.trim() ? 500 : 220,
        maxCandidateSets: targetQuery.trim() ? 20 : 12,
        targetQuery: targetQuery.trim() || null,
        ignoreNegativeMatches
      })
    });

    const payload = await response.json().catch(() => ({}));
    setGenerating(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke lage AI-forslag");
      return;
    }

    setNotice(
      `Laget ${payload.createdCount ?? 0} forslag fra ${payload.candidateSetCount ?? 0} kandidatsett${
        payload.targetQuery ? ` for “${payload.targetQuery}”` : ""
      }${payload.ignoreNegativeMatches ? " Tidligere avviste matcher ble ignorert." : ""}.`
    );
    await load();
  }

  function toggleSuggestionMember(suggestionId: string, memberId: string) {
    setSelectedSuggestionMembers((current) => {
      const selected = new Set(current[suggestionId] ?? []);
      if (selected.has(memberId)) {
        selected.delete(memberId);
      } else {
        selected.add(memberId);
      }

      return {
        ...current,
        [suggestionId]: [...selected]
      };
    });
  }

  async function reviewSuggestion(id: string, action: "approve" | "reject") {
    setError("");
    setNotice("");

    const response = await authFetch(`/api/admin/product-groups/suggestions/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "approve"
          ? {
              selectedMemberIds: selectedSuggestionMembers[id] ?? [],
              rememberRemovedMembers
            }
          : {
              rememberRejectedPairs
            }
      )
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke behandle forslaget");
      return;
    }

    setNotice(
      action === "approve"
        ? `Forslaget ble godkjent med ${payload.memberCount ?? 0} EAN-varer. ${payload.negativeMatchCount ?? 0} negative matcher ble lagret.`
        : `Forslaget ble avvist. ${payload.negativeMatchCount ?? 0} negative matcher ble lagret.`
    );
    await load();
  }

  async function removeGroupMember(groupId: string, memberId: string) {
    setError("");
    setNotice("");

    const response = await authFetch(`/api/admin/product-groups/${groupId}/members/${memberId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rememberAsNegative: rememberRemovedMembers })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke ta EAN-varen ut av den overordnede varenn");
      return;
    }

    setNotice(`EAN-varen ble tatt ut av den overordnede varenn. ${payload.negativeMatchCount ?? 0} negative matcher ble lagret.`);
    await load();
  }

  return (
    <AppShell active="Systemadmin">
      <div className="space-y-6">
        <section className="rounded-3xl bg-gradient-to-br from-slate-900 to-emerald-900 p-6 text-white shadow-soft">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">System Admin</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Overordnede varer</h1>
              <p className="mt-2 max-w-3xl text-white/80">
                Løsningen foreslår globale overordnede varer på tvers av EAN og pakningsstørrelser.
                System Admin godkjenner før de overordnede varene brukes i vanlig brukerflate.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={generateSuggestions}
                disabled={generating}
                className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-900 shadow-soft disabled:opacity-50"
              >
                {generating ? "Analyserer..." : "Lag AI-forslag"}
              </button>
              <button
                type="button"
                onClick={load}
                className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/30"
              >
                Oppdater
              </button>
              <a
                href="/admin/product-groups/merge"
                className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/30"
              >
                Slå sammen overordnede varer
              </a>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>
        ) : null}
        {notice ? (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-brand">{notice}</div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard title="Overordnede varer" value={String(groups.length)} subtitle="Godkjente overordnede varer" tone="green" />
          <StatCard title="EAN-varer" value={String(memberCount)} subtitle="EAN-produkter i grupper" tone="amber" />
          <StatCard title="AI-forslag" value={String(suggestions.length)} subtitle="Venter på godkjenning" tone="purple" />
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-bold">AI-forslag til verifisering</h2>
              <p className="mt-1 text-sm text-muted">
                Forslagene er laget fra eksisterende produktdata, enhetspris, merke, kategori og AI-analyse.
              </p>
              <div className="mt-3 grid gap-2 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rememberRemovedMembers}
                    onChange={(event) => setRememberRemovedMembers(event.target.checked)}
                  />
                  Husk bortvalgte EAN-varer som ikke sammenlignbare med godkjente EAN-varer
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rememberRejectedPairs}
                    onChange={(event) => setRememberRejectedPairs(event.target.checked)}
                  />
                  Husk avviste forslag som negative matcher
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ignoreNegativeMatches}
                    onChange={(event) => setIgnoreNegativeMatches(event.target.checked)}
                  />
                  Ignorer tidligere avviste matcher ved ny kjøring
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={targetQuery}
                onChange={(event) => setTargetQuery(event.target.value)}
                placeholder="Søk, f.eks. cola zero"
                className="rounded-2xl border border-line px-4 py-3 text-sm"
              />
              <button
                type="button"
                onClick={generateSuggestions}
                disabled={generating}
                className="rounded-2xl bg-brand px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {generating ? "Analyserer..." : "Lag forslag"}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {suggestions.length ? (
              suggestions.map((suggestion) => (
                <article key={suggestion.id} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="text-lg font-bold">{suggestion.suggested_group_name}</h3>
                      <p className="text-sm text-muted">
                        {[suggestion.brand, suggestion.category, unitLabel(suggestion.comparison_unit), percent(suggestion.confidence)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {suggestion.reason ? <p className="mt-2 text-sm text-slate-700">{suggestion.reason}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => reviewSuggestion(suggestion.id, "reject")}
                        className="rounded-2xl border border-line px-4 py-2 text-sm font-bold text-slate-700"
                      >
                        Avvis
                      </button>
                      <button
                        type="button"
                        onClick={() => reviewSuggestion(suggestion.id, "approve")}
                        className="rounded-2xl bg-brand px-4 py-2 text-sm font-bold text-white"
                      >
                        Godkjenn
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {suggestion.product_group_suggestion_members?.map((member) => {
                      const selected = (selectedSuggestionMembers[suggestion.id] ?? []).includes(member.id);
                      return (
                        <label
                          key={member.id}
                          className={`flex gap-3 rounded-xl p-3 text-sm ${
                            selected ? "bg-emerald-50 ring-1 ring-emerald-100" : "bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSuggestionMember(suggestion.id, member.id)}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold">{member.products?.name ?? member.product_id}</span>
                            <span className="block text-muted">
                              {relationshipLabels[member.relationship_type] ?? member.relationship_type}
                              {member.confidence !== null ? ` · ${percent(member.confidence)}` : ""}
                            </span>
                            {member.reason ? <span className="mt-1 block text-xs text-slate-600">{member.reason}</span> : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </article>
              ))
            ) : (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">
                Ingen ventende forslag. Trykk “Lag AI-forslag” for å analysere produkter uten overordnet vare.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-bold">Opprett overordnet vare manuelt</h2>
          <p className="mt-1 text-sm text-muted">Brukes til korrigering og test. AI-forslag er hovedflyten.</p>

          <form onSubmit={createGroup} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="text-sm font-semibold">
              Navn på overordnet vare
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
                placeholder="Norvegia 26% gulost"
                className="mt-1 w-full rounded-2xl border border-line px-3 py-2"
              />
            </label>
            <label className="text-sm font-semibold">
              Merke
              <input
                value={form.brand}
                onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value }))}
                placeholder="Tine"
                className="mt-1 w-full rounded-2xl border border-line px-3 py-2"
              />
            </label>
            <label className="text-sm font-semibold">
              Kategori
              <input
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                placeholder="Ost"
                className="mt-1 w-full rounded-2xl border border-line px-3 py-2"
              />
            </label>
            <label className="text-sm font-semibold">
              Sammenlignes som
              <select
                value={form.comparison_unit}
                onChange={(event) => setForm((current) => ({ ...current, comparison_unit: event.target.value }))}
                className="mt-1 w-full rounded-2xl border border-line px-3 py-2"
              >
                <option value="kg">kr/kg</option>
                <option value="l">kr/l</option>
                <option value="stk">kr/stk</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={saving}
              className="self-end rounded-2xl bg-brand px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? "Lagrer..." : "Opprett overordnet vare"}
            </button>
            <label className="md:col-span-2 xl:col-span-5 text-sm font-semibold">
              Beskrivelse
              <input
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Samme faktiske vare, ulike pakningsstørrelser"
                className="mt-1 w-full rounded-2xl border border-line px-3 py-2"
              />
            </label>
          </form>
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-bold">Godkjente overordnede varer</h2>
          <div className="mt-4 space-y-3">
            {groups.length ? (
              groups.map((group) => (
                <article key={group.id} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-bold">{group.name}</h3>
                      <p className="text-sm text-muted">
                        {[group.brand, group.category, unitLabel(group.comparison_unit)].filter(Boolean).join(" · ")}
                      </p>
                      {group.description ? <p className="mt-2 text-sm text-slate-700">{group.description}</p> : null}
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-brand">
                      {group.product_group_members?.length ?? 0} EAN-varer
                    </span>
                  </div>

                  {group.product_group_members?.length ? (
                    <div className="mt-3 grid gap-2">
                      {group.product_group_members.map((member) => (
                        <div key={member.id} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                          <div>
                            <p className="font-semibold">{member.products?.name ?? member.product_id}</p>
                            <p className="text-muted">
                              {relationshipLabels[member.relationship_type] ?? member.relationship_type}
                              {member.confidence !== null ? ` · ${percent(member.confidence)}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeGroupMember(group.id, member.id)}
                            className="rounded-xl border border-line px-3 py-2 text-xs font-bold text-slate-700 hover:bg-white"
                          >
                            Ta ut
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">Ingen EAN-varer ennå.</p>
                  )}
                </article>
              ))
            ) : (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">
                Ingen godkjente overordnede varer ennå.
              </p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
