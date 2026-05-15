"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { authFetch } from "@/lib/auth-fetch";

type Household = {
  id: string;
  name: string;
  monthly_budget: number | null;
  created_at: string | null;
};

type MemberRole = "admin" | "member" | "child";

type Member = {
  id: string;
  user_id: string;
  display_name: string;
  role: MemberRole;
  email: string | null;
  created_at: string | null;
  is_current_user?: boolean;
};

type StorePreference = {
  id: string;
  store_key: string;
  store_name: string;
  priority: number | null;
  is_enabled: boolean | null;
  updated_at: string | null;
};

type PriceSourcePreferences = {
  include_kassalapp: boolean | null;
  include_own_shelf_edge: boolean | null;
  include_other_shelf_edge: boolean | null;
  include_own_receipt: boolean | null;
  include_other_receipt: boolean | null;
  include_own_manual: boolean | null;
  include_other_manual: boolean | null;
  updated_at?: string | null;
};

type PriceSourcePreferenceKey = keyof Omit<PriceSourcePreferences, "updated_at">;

type AdminPayload = {
  household: Household;
  members: Member[];
  currentUserId: string;
  currentRole: MemberRole;
};

const roles: Array<{ value: MemberRole; label: string; description: string }> = [
  { value: "admin", label: "Admin", description: "Kan administrere husholdning og medlemmer" },
  { value: "member", label: "Medlem", description: "Kan bruke appen normalt" },
  { value: "child", label: "Barn", description: "Begrenset rolle for senere funksjoner" }
];

const priceSourceOptions: Array<{ key: PriceSourcePreferenceKey; label: string; description: string }> = [
  {
    key: "include_kassalapp",
    label: "Kassalapp API",
    description: "Offentlige prisdata hentet fra Kassalapp. Anbefales på."
  },
  {
    key: "include_own_shelf_edge",
    label: "Egne hyllekant-/skannepriser",
    description: "Priser dere selv har registrert via hyllekant eller mobilscan."
  },
  {
    key: "include_other_shelf_edge",
    label: "Hyllekant-/skannepriser fra andre",
    description: "Delte prisobservasjoner fra andre husholdninger."
  },
  {
    key: "include_own_receipt",
    label: "Egne kvitteringspriser",
    description: "Priser hentet fra deres egne kvitteringer."
  },
  {
    key: "include_other_receipt",
    label: "Kvitteringspriser fra andre",
    description: "Anonymiserte prisobservasjoner fra andres kvitteringer."
  },
  {
    key: "include_own_manual",
    label: "Egne manuelle priser",
    description: "Priser lagt inn manuelt av denne husholdningen."
  },
  {
    key: "include_other_manual",
    label: "Manuelle priser fra andre",
    description: "Delte manuelle prisobservasjoner fra andre husholdninger."
  }
];

function roleLabel(role: MemberRole) {
  return roles.find((item) => item.value === role)?.label ?? role;
}

function roleClass(role: MemberRole) {
  if (role === "admin") return "bg-emerald-50 text-brand";
  if (role === "child") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function AdminPage() {
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [householdName, setHouseholdName] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState("0");
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState<MemberRole>("member");
  const [stores, setStores] = useState<StorePreference[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const [priceSourcePreferences, setPriceSourcePreferences] = useState<PriceSourcePreferences | null>(null);
  const [priceSourcePreferencesLoading, setPriceSourcePreferencesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStores() {
    setStoresLoading(true);

    try {
      const response = await authFetch("/api/admin/stores", { cache: "no-store" });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke hente butikkoppsett");
      }

      setStores(result?.data?.stores ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente butikkoppsett");
    } finally {
      setStoresLoading(false);
    }
  }

  async function loadPriceSourcePreferences() {
    setPriceSourcePreferencesLoading(true);

    try {
      const response = await authFetch("/api/admin/price-source-preferences", { cache: "no-store" });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke hente priskildevalg");
      }

      setPriceSourcePreferences(result?.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente priskildevalg");
    } finally {
      setPriceSourcePreferencesLoading(false);
    }
  }

  async function loadAdmin() {
    setLoading(true);
    setError(null);

    try {
      const response = await authFetch("/api/admin/household", { cache: "no-store" });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke hente admin-data");
      }

      const data = result.data as AdminPayload;
      setPayload(data);
      setHouseholdName(data.household.name ?? "");
      setMonthlyBudget(String(data.household.monthly_budget ?? 0));
      await Promise.all([loadStores(), loadPriceSourcePreferences()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente admin-data");
    } finally {
      setLoading(false);
    }
  }

  async function saveHousehold(event: React.FormEvent) {
    event.preventDefault();
    setSaving("household");
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch("/api/admin/household", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: householdName, monthly_budget: monthlyBudget })
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke lagre husholdning");
      }

      setMessage("Husholdningen er oppdatert.");
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre husholdning");
    } finally {
      setSaving(null);
    }
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    setSaving("add-member");
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, display_name: newDisplayName, role: newRole })
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke legge til medlem");
      }

      setNewEmail("");
      setNewDisplayName("");
      setNewRole("member");
      setMessage("Medlemmet er lagt til. Be personen logge inn med magic link.");
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke legge til medlem");
    } finally {
      setSaving(null);
    }
  }

  async function updateMember(memberId: string, updates: Partial<Pick<Member, "display_name" | "role">>) {
    setSaving(memberId);
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch(`/api/admin/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke oppdatere medlem");
      }

      setMessage("Medlemmet er oppdatert.");
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oppdatere medlem");
    } finally {
      setSaving(null);
    }
  }

  async function deleteMember(member: Member) {
    if (!window.confirm(`Fjerne ${member.display_name} fra husholdningen?`)) return;
    setSaving(member.id);
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch(`/api/admin/members/${member.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke fjerne medlem");
      }

      setMessage("Medlemmet er fjernet fra husholdningen.");
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke fjerne medlem");
    } finally {
      setSaving(null);
    }
  }

  async function updateStore(store: StorePreference, updates: Partial<Pick<StorePreference, "priority" | "is_enabled">>) {
    const nextStore = { ...store, ...updates };
    setStores((current) => current.map((item) => item.store_key === store.store_key ? nextStore : item));
    setSaving(`store-${store.store_key}`);
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch("/api/admin/stores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_key: store.store_key,
          store_name: store.store_name,
          priority: nextStore.priority ?? 100,
          is_enabled: nextStore.is_enabled !== false
        })
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke lagre butikkoppsett");
      }

      setMessage("Butikkoppsettet er oppdatert.");
      await loadStores();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre butikkoppsett");
      await loadStores();
    } finally {
      setSaving(null);
    }
  }

  async function updatePriceSourcePreference(key: PriceSourcePreferenceKey, value: boolean) {
    if (!priceSourcePreferences) return;

    const nextPreferences = { ...priceSourcePreferences, [key]: value };
    setPriceSourcePreferences(nextPreferences);
    setSaving(`price-source-${key}`);
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch("/api/admin/price-source-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value })
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? "Kunne ikke lagre priskildevalg");
      }

      setPriceSourcePreferences(result?.data ?? nextPreferences);
      setMessage("Priskildevalgene er oppdatert.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre priskildevalg");
      await loadPriceSourcePreferences();
    } finally {
      setSaving(null);
    }
  }

  useEffect(() => {
    loadAdmin().catch(() => undefined);
  }, []);

  const adminCount = useMemo(() => payload?.members.filter((member) => member.role === "admin").length ?? 0, [payload]);

  return (
    <AppShell active="Admin">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-heading">Admin</h1>
          <p className="page-subtitle">Administrer husholdningen, medlemmer og hvem som har admin-tilgang.</p>
        </div>
        <button onClick={loadAdmin} disabled={loading} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-brand disabled:opacity-60">
          {loading ? "Laster..." : "Oppdater"}
        </button>
      </div>

      {message ? <p className="notice-success mt-5">{message}</p> : null}
      {error ? <p className="notice-error mt-5">{error}</p> : null}

      {loading && !payload ? (
        <section className="card mt-8 p-6 text-sm text-muted">Laster admin-grensesnitt...</section>
      ) : null}

      {payload ? (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
            <StatCard title="Husholdning" value={payload.household.name} subtitle="Aktiv familie" />
            <StatCard title="Medlemmer" value={String(payload.members.length)} subtitle="Koblet til husholdningen" tone="blue" />
            <StatCard title="Adminer" value={String(adminCount)} subtitle="Kan administrere brukere" tone="amber" />
            <StatCard title="Din rolle" value={roleLabel(payload.currentRole)} subtitle="Innlogget bruker" tone="purple" />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
            <aside className="space-y-6">
              <section className="card p-5">
                <h2 className="section-title">Husholdning</h2>
                <p className="section-subtitle">Endre navn og budsjett som vises i appen.</p>

                <form onSubmit={saveHousehold} className="mt-5 space-y-4">
                  <label className="block text-sm font-medium text-slate-700">
                    Navn
                    <input
                      value={householdName}
                      onChange={(event) => setHouseholdName(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                    />
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Månedlig budsjett
                    <input
                      value={monthlyBudget}
                      onChange={(event) => setMonthlyBudget(event.target.value)}
                      inputMode="decimal"
                      className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                    />
                  </label>

                  <button disabled={saving === "household" || !householdName.trim()} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                    {saving === "household" ? "Lagrer..." : "Lagre husholdning"}
                  </button>
                </form>
              </section>

              <section className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="section-title">Butikker i prissammenligning</h2>
                    <p className="section-subtitle">
                      Slå av butikker du ikke vil se. Lavere prioritet velges først ved lik pris.
                    </p>
                  </div>
                  <button type="button" onClick={loadStores} disabled={storesLoading} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-brand disabled:opacity-60">
                    {storesLoading ? "Laster" : "Oppdater"}
                  </button>
                </div>

                <div className="mt-5 space-y-3">
                  {stores.map((store) => (
                    <div key={store.store_key} className="rounded-2xl border border-line p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{store.store_name}</p>
                          <p className="mt-1 text-xs text-muted">Prioritet {store.priority ?? 100} · {store.is_enabled === false ? "Skjult" : "Synlig"}</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={store.is_enabled !== false}
                            disabled={saving === `store-${store.store_key}`}
                            onChange={(event) => updateStore(store, { is_enabled: event.target.checked })}
                          />
                          Vis
                        </label>
                      </div>

                      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Prioritet
                        <input
                          type="number"
                          min="1"
                          max="999"
                          defaultValue={store.priority ?? 100}
                          disabled={saving === `store-${store.store_key}`}
                          onBlur={(event) => {
                            const value = Number(event.target.value || 100);
                            if (Number.isFinite(value) && value !== (store.priority ?? 100)) {
                              updateStore(store, { priority: value });
                            }
                          }}
                          className="mt-2 w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
                        />
                      </label>
                    </div>
                  ))}

                  {!stores.length ? (
                    <p className="rounded-xl bg-slate-50 p-4 text-sm text-muted">
                      Ingen butikker funnet ennå. Synk priser for basisutvalget først, så dukker butikkene opp her.
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="section-title">Priskilder i sammenligning</h2>
                    <p className="section-subtitle">
                      Velg hvilke prisobservasjoner som skal brukes i dashboard og prissammenligning.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadPriceSourcePreferences}
                    disabled={priceSourcePreferencesLoading}
                    className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-brand disabled:opacity-60"
                  >
                    {priceSourcePreferencesLoading ? "Laster" : "Oppdater"}
                  </button>
                </div>

                {priceSourcePreferences ? (
                  <div className="mt-5 space-y-3">
                    {priceSourceOptions.map((option) => (
                      <label key={option.key} className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between rounded-2xl border border-line p-4">
                        <span>
                          <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
                          <span className="mt-1 block text-xs leading-5 text-muted">{option.description}</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={priceSourcePreferences[option.key] !== false}
                          disabled={saving === `price-source-${option.key}`}
                          onChange={(event) => updatePriceSourcePreference(option.key, event.target.checked)}
                          className="mt-1"
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-muted">
                    Ingen priskildevalg funnet ennå. Trykk Oppdater, eller lagre et valg for å opprette standardoppsettet.
                  </p>
                )}
              </section>

              <section className="card p-5">
                <h2 className="section-title">Legg til bruker</h2>
                <p className="section-subtitle">Brukeren opprettes i Supabase Auth hvis e-posten ikke finnes. Personen kan deretter logge inn med magic link.</p>

                <form onSubmit={addMember} className="mt-5 space-y-4">
                  <label className="block text-sm font-medium text-slate-700">
                    E-post
                    <input
                      value={newEmail}
                      onChange={(event) => setNewEmail(event.target.value)}
                      type="email"
                      required
                      className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                    />
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Visningsnavn
                    <input
                      value={newDisplayName}
                      onChange={(event) => setNewDisplayName(event.target.value)}
                      placeholder="Valgfritt"
                      className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                    />
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Rolle
                    <select
                      value={newRole}
                      onChange={(event) => setNewRole(event.target.value as MemberRole)}
                      className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                    >
                      {roles.map((role) => (
                        <option key={role.value} value={role.value}>{role.label}</option>
                      ))}
                    </select>
                  </label>

                  <button disabled={saving === "add-member" || !newEmail.trim()} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                    {saving === "add-member" ? "Legger til..." : "Legg til bruker"}
                  </button>
                </form>
              </section>
            </aside>

            <section className="card overflow-hidden">
              <div className="border-b border-line p-5">
                <h2 className="section-title">Brukere i husholdningen</h2>
                <p className="text-sm leading-6 text-muted">Endre rolle til admin, medlem eller barn. Husholdningen må alltid ha minst én admin.</p>
              </div>

              <div className="divide-y divide-line">
                {payload.members.map((member) => (
                  <article key={member.id} className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_180px_130px] p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          defaultValue={member.display_name}
                          onBlur={(event) => {
                            const value = event.target.value.trim();
                            if (value && value !== member.display_name) {
                              updateMember(member.id, { display_name: value });
                            }
                          }}
                          className="min-w-0 rounded-xl border border-line px-3 py-2 text-sm font-semibold outline-none focus:border-brand"
                        />
                        {member.is_current_user ? <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">Deg</span> : null}
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${roleClass(member.role)}`}>{roleLabel(member.role)}</span>
                      </div>
                      <p className="mt-2 text-sm text-muted">{member.email ?? "E-post ikke funnet"}</p>
                      <p className="mt-1 text-xs text-slate-400">User ID: {member.user_id}</p>
                    </div>

                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rolle</label>
                      <select
                        value={member.role}
                        disabled={saving === member.id}
                        onChange={(event) => updateMember(member.id, { role: event.target.value as MemberRole })}
                        className="mt-2 w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
                      >
                        {roles.map((role) => (
                          <option key={role.value} value={role.value}>{role.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-end justify-end">
                      <button
                        onClick={() => deleteMember(member)}
                        disabled={saving === member.id || member.is_current_user}
                        className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Fjern
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
