"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { authFetch } from "@/lib/auth-fetch";

type HouseholdSummary = {
  id: string;
  name: string;
  role: "admin" | "member";
};

type UserMetrics = {
  basis_product_count: number;
  scanned_price_count: number;
  manual_price_count: number;
  receipt_price_count: number;
  user_registered_price_count: number;
};

type AdminUser = {
  id: string;
  email: string;
  created_at: string | null;
  last_sign_in_at: string | null;
  confirmed_at: string | null;
  household_count: number;
  households: HouseholdSummary[];
  metrics: UserMetrics;
  can_delete: boolean;
};

type UsersPayload = {
  users: AdminUser[];
  page: number;
  perPage: number;
  totalApprox: number;
  metricsWarning?: string | null;
};

function dateLabel(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function compactDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(value));
}

function householdChipLabel(household: HouseholdSummary) {
  return `${household.name}${household.role === "admin" ? " · admin" : ""}`;
}

function userMetrics(user: AdminUser): UserMetrics {
  return user.metrics ?? {
    basis_product_count: 0,
    scanned_price_count: 0,
    manual_price_count: 0,
    receipt_price_count: 0,
    user_registered_price_count: 0
  };
}

export default function SystemUsersPage() {
  const [data, setData] = useState<UsersPayload | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const users = data?.users ?? [];
  const withoutHousehold = useMemo(() => users.filter((user) => user.household_count === 0).length, [users]);
  const withHousehold = useMemo(() => users.filter((user) => user.household_count > 0).length, [users]);
  const totalBasisProducts = useMemo(() => users.reduce((sum, user) => sum + userMetrics(user).basis_product_count, 0), [users]);
  const totalUserPrices = useMemo(() => users.reduce((sum, user) => sum + userMetrics(user).user_registered_price_count, 0), [users]);

  async function loadUsers(search = query) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim().toLowerCase());
      params.set("per_page", "200");

      const response = await authFetch(`/api/admin/users?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Kunne ikke hente brukere");
      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente brukere");
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!user.can_delete) return;
    if (!window.confirm(`Slette brukeren ${user.email}? Dette kan ikke angres.`)) return;

    setSaving(user.id);
    setError("");
    setNotice("");

    try {
      const response = await authFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Kunne ikke slette brukeren");
      setNotice(`Brukeren ${user.email} er slettet.`);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke slette brukeren");
    } finally {
      setSaving("");
    }
  }

  useEffect(() => {
    loadUsers("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell active="Systembrukere">
      <div className="space-y-6">
        <section className="rounded-3xl bg-gradient-to-br from-slate-950 to-slate-800 p-6 text-white shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Systemadmin</p>
          <h1 className="mt-2 text-3xl font-black">Brukere</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold text-slate-300">
            Plasseffektiv oversikt over auth-brukere og hvilke husholdninger de er koblet til. Brukere uten husholdning kan slettes.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <StatCard title="Viste brukere" value={String(users.length)} tone="blue" subtitle={data ? `Side ${data.page}` : "Laster"} />
          <StatCard title="Med husholdning" value={String(withHousehold)} tone="green" subtitle="Kan ikke slettes her" />
          <StatCard title="Basisprodukter" value={String(totalBasisProducts)} tone="purple" subtitle="På viste brukere" />
          <StatCard title="Egne priser" value={String(totalUserPrices)} tone="amber" subtitle="Skann, manuelt og kvittering" />
        </section>

        <section className="rounded-3xl border border-line bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <label className="block flex-1 text-sm font-bold text-slate-700">
              Søk e-post
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") loadUsers();
                }}
                placeholder="navn@eksempel.no"
                className="mt-2 w-full rounded-2xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
              />
            </label>
            <div className="flex gap-2">
              <button onClick={() => loadUsers()} className="rounded-2xl bg-brand px-4 py-3 text-sm font-black text-white">Søk</button>
              <button
                onClick={() => {
                  setQuery("");
                  loadUsers("");
                }}
                className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-black text-slate-700"
              >
                Nullstill
              </button>
            </div>
          </div>

          {notice ? <p className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-brand">{notice}</p> : null}
          {data?.metricsWarning ? <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-800">{data.metricsWarning}</p> : null}
          {error ? <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}

          <div className="mt-5 overflow-hidden rounded-2xl border border-line">
            <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(210px,1.45fr)_minmax(170px,0.95fr)_95px_95px_90px] gap-0 bg-slate-50 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              <div>Bruker</div>
              <div>Husholdninger</div>
              <div>Basis/priser</div>
              <div>Opprettet</div>
              <div>Sist inn</div>
              <div className="text-right">Handling</div>
            </div>

            {loading ? <p className="p-4 text-sm font-semibold text-muted">Laster brukere...</p> : null}

            {!loading && users.length === 0 ? <p className="p-4 text-sm font-semibold text-muted">Ingen brukere funnet.</p> : null}

            {!loading && users.map((user) => (
              <div key={user.id} className="grid grid-cols-[minmax(180px,1.2fr)_minmax(210px,1.45fr)_minmax(170px,0.95fr)_95px_95px_90px] items-center border-t border-line px-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-black text-slate-900" title={user.email}>{user.email || "(uten e-post)"}</p>
                  <p className="mt-0.5 truncate text-[11px] font-mono text-slate-400" title={user.id}>{user.id}</p>
                  {!user.confirmed_at ? <p className="mt-1 text-xs font-bold text-amber-700">Ikke bekreftet</p> : null}
                </div>

                <div className="min-w-0">
                  {user.households.length > 0 ? (
                    <div className="flex max-h-16 flex-wrap gap-1 overflow-hidden">
                      {user.households.slice(0, 4).map((household) => (
                        <span key={household.id} title={householdChipLabel(household)} className="max-w-[180px] truncate rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-brand">
                          {householdChipLabel(household)}
                        </span>
                      ))}
                      {user.households.length > 4 ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">+{user.households.length - 4}</span> : null}
                    </div>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">Ingen husholdning</span>
                  )}
                </div>

                <div className="text-xs font-semibold text-slate-600">
                  <p><span className="font-black text-slate-800">{userMetrics(user).basis_product_count}</span> basis</p>
                  <p className="mt-1 text-slate-500">
                    <span className="font-black text-slate-800">{userMetrics(user).user_registered_price_count}</span> priser
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400" title="Skannet hyllekant / manuelt / kvitteringsmatch">
                    S {userMetrics(user).scanned_price_count} · M {userMetrics(user).manual_price_count} · K {userMetrics(user).receipt_price_count}
                  </p>
                </div>
                <div className="text-xs font-semibold text-slate-500" title={dateLabel(user.created_at)}>{compactDate(user.created_at)}</div>
                <div className="text-xs font-semibold text-slate-500" title={dateLabel(user.last_sign_in_at)}>{compactDate(user.last_sign_in_at)}</div>
                <div className="text-right">
                  <button
                    onClick={() => deleteUser(user)}
                    disabled={!user.can_delete || saving === user.id}
                    title={user.can_delete ? "Slett bruker uten husholdning" : "Kan ikke slettes fordi bruker har husholdning"}
                    className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-black text-rose-600 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {saving === user.id ? "..." : "Slett"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
