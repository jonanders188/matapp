"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { authFetch } from "@/lib/auth-fetch";

type ProductInMember = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  package_size?: string | null;
};

type GroupMember = {
  id: string;
  product_id: string;
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
  product_group_members: GroupMember[];
};

type MergeCandidate = {
  left: ProductGroup;
  right: ProductGroup;
  score: number;
  reasons: string[];
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length >= 2));
}

function similarity(a: string, b: string) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }
  return common / Math.max(left.size, right.size);
}

function groupText(group: ProductGroup) {
  return [
    group.name,
    group.brand,
    group.category,
    group.comparison_unit,
    ...(group.product_group_members ?? []).map((member) => member.products?.name ?? "")
  ].join(" ");
}

function candidateFor(left: ProductGroup, right: ProductGroup): MergeCandidate | null {
  if (left.id === right.id) return null;
  if (left.status === "archived" || right.status === "archived") return null;

  let score = 0;
  const reasons: string[] = [];

  const leftBrand = normalizeText(left.brand);
  const rightBrand = normalizeText(right.brand);
  if (leftBrand && rightBrand && (leftBrand === rightBrand || leftBrand.includes(rightBrand) || rightBrand.includes(leftBrand))) {
    score += 25;
    reasons.push("likt merke");
  }

  const leftCategory = normalizeText(left.category);
  const rightCategory = normalizeText(right.category);
  if (leftCategory && rightCategory && (leftCategory === rightCategory || leftCategory.includes(rightCategory) || rightCategory.includes(leftCategory))) {
    score += 20;
    reasons.push("lik kategori");
  }

  if (left.comparison_unit && right.comparison_unit && left.comparison_unit === right.comparison_unit) {
    score += 15;
    reasons.push(`samme enhet (${left.comparison_unit})`);
  }

  const nameScore = similarity(left.name, right.name);
  if (nameScore >= 0.15) {
    score += Math.round(nameScore * 50);
    reasons.push("lignende overordnet varenavn");
  }

  const fullScore = similarity(groupText(left), groupText(right));
  if (fullScore >= 0.10) {
    score += Math.round(fullScore * 40);
    reasons.push("lignende EAN-varer");
  }

  if (normalizeText(left.name).includes(normalizeText(right.name)) || normalizeText(right.name).includes(normalizeText(left.name))) {
    score += 20;
    reasons.push("navn inneholder hverandre");
  }

  if (score < 25) return null;
  return { left, right, score, reasons };
}

function unitLabel(unit: string | null) {
  if (unit === "kg") return "kr/kg";
  if (unit === "l") return "kr/l";
  if (unit === "stk") return "kr/stk";
  return unit ?? "Ikke satt";
}

function groupSummary(group: ProductGroup) {
  return [group.brand, group.category, unitLabel(group.comparison_unit), `${group.product_group_members?.length ?? 0} EAN-varer`]
    .filter(Boolean)
    .join(" · ");
}

export default function ProductGroupMergePage() {
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState("");
  const [search, setSearch] = useState("");
  const [targetGroupId, setTargetGroupId] = useState("");
  const [sourceGroupId, setSourceGroupId] = useState("");

  const activeGroups = useMemo(
    () => groups.filter((group) => group.status !== "archived"),
    [groups]
  );

  const filteredGroups = useMemo(() => {
    const query = normalizeText(search);
    if (!query) return activeGroups;

    return activeGroups.filter((group) => normalizeText(groupText(group)).includes(query));
  }, [activeGroups, search]);

  const candidates = useMemo(() => {
    const pool = filteredGroups.length ? filteredGroups : activeGroups;
    const found: MergeCandidate[] = [];
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const candidate = candidateFor(pool[i], pool[j]);
        if (candidate) found.push(candidate);
      }
    }
    return found.sort((a, b) => b.score - a.score).slice(0, 50);
  }, [activeGroups, filteredGroups]);

  async function load() {
    setLoading(true);
    setError("");
    const response = await authFetch("/api/admin/product-groups");
    const payload = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente overordnede varer");
      return;
    }

    setGroups(payload.groups ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function mergeGroups(targetId: string, sourceId: string) {
    if (!targetId || !sourceId || targetId === sourceId) {
      setError("Velg to ulike overordnede varer.");
      return;
    }

    setMerging(`${targetId}:${sourceId}`);
    setError("");
    setNotice("");

    const response = await authFetch("/api/admin/product-groups/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetGroupId: targetId, sourceGroupId: sourceId })
    });

    const payload = await response.json().catch(() => ({}));
    setMerging("");

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke slå sammen overordnet varene");
      return;
    }

    setNotice(`De overordnede varene ble slått sammen. ${payload.movedMemberCount ?? 0} EAN-varer ble flyttet.`);
    setTargetGroupId("");
    setSourceGroupId("");
    await load();
  }

  return (
    <AppShell active="Systemadmin">
      <div className="space-y-6">
        <section className="rounded-3xl bg-gradient-to-br from-slate-900 to-emerald-900 p-6 text-white shadow-soft">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">System Admin</p>
          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Slå sammen overordnede varer</h1>
              <p className="mt-2 max-w-3xl text-white/80">
                Siden viser forslag, men lar deg også slå sammen overordnede varer manuelt. Velg overordnet varen som skal beholdes og overordnet varen som skal fjernes.
              </p>
            </div>
            <a href="/admin/product-groups" className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/30">
              Tilbake
            </a>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        {notice ? <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-brand">{notice}</div> : null}

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard title="Aktive overordnede varer" value={String(activeGroups.length)} subtitle="Kan slås sammen" tone="green" />
          <StatCard title="Treff" value={String(filteredGroups.length)} subtitle="Etter søk/filter" tone="blue" />
          <StatCard title="Forslag" value={String(candidates.length)} subtitle={loading ? "Laster..." : "Mulige duplikater"} tone="amber" />
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <h2 className="text-xl font-bold">Manuell sammenslåing</h2>
          <p className="mt-1 text-sm text-muted">
            Bruk denne når automatisk forslag ikke finner duplikatet. Kildeoverordnet varen fjernes etter sammenslåing.
          </p>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
            <label className="text-sm font-semibold">
              Behold denne overordnede varennn
              <select
                value={targetGroupId}
                onChange={(event) => setTargetGroupId(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-line px-3 py-2"
              >
                <option value="">Velg overordnet vare</option>
                {activeGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name} · {groupSummary(group)}</option>
                ))}
              </select>
            </label>

            <label className="text-sm font-semibold">
              Slå inn / fjern denne
              <select
                value={sourceGroupId}
                onChange={(event) => setSourceGroupId(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-line px-3 py-2"
              >
                <option value="">Velg overordnet vare</option>
                {activeGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name} · {groupSummary(group)}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={Boolean(merging)}
              onClick={() => mergeGroups(targetGroupId, sourceGroupId)}
              className="self-end rounded-2xl bg-brand px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Slå sammen
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-bold">Forslag til sammenslåing</h2>
              <p className="mt-1 text-sm text-muted">
                Søk etter f.eks. “cola”, “zero”, “melkesjokolade” eller “ketchup”.
              </p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Søk i overordnede varer"
              className="rounded-2xl border border-line px-4 py-3 text-sm"
            />
          </div>

          <div className="mt-4 space-y-4">
            {candidates.length ? candidates.map((candidate) => (
              <article key={`${candidate.left.id}:${candidate.right.id}`} className="rounded-2xl border border-line p-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="grid gap-3 md:grid-cols-2">
                    {[candidate.left, candidate.right].map((group) => (
                      <div key={group.id} className="rounded-2xl bg-slate-50 p-4">
                        <h3 className="font-bold">{group.name}</h3>
                        <p className="mt-1 text-sm text-muted">{groupSummary(group)}</p>
                        <div className="mt-2 space-y-1">
                          {(group.product_group_members ?? []).slice(0, 6).map((member) => (
                            <p key={member.id} className="text-xs text-slate-600">{member.products?.name ?? member.product_id}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex min-w-[220px] flex-col justify-between gap-3 rounded-2xl bg-amber-50 p-4">
                    <div>
                      <p className="text-sm font-bold text-amber-900">Score {candidate.score}</p>
                      <p className="mt-1 text-xs text-amber-800">{candidate.reasons.join(" · ")}</p>
                    </div>
                    <div className="grid gap-2">
                      <button
                        type="button"
                        disabled={Boolean(merging)}
                        onClick={() => mergeGroups(candidate.left.id, candidate.right.id)}
                        className="rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Behold {candidate.left.name}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(merging)}
                        onClick={() => mergeGroups(candidate.right.id, candidate.left.id)}
                        className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                      >
                        Behold {candidate.right.name}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            )) : (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted">
                Ingen forslag akkurat nå. Bruk manuell sammenslåing over.
              </p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
