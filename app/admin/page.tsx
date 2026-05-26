"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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


type PendingInvitation = {
  id: string;
  email: string;
  display_name: string | null;
  role: MemberRole | string | null;
  status: string | null;
  expires_at: string | null;
  created_at: string | null;
};

type Invitation = {
  id: string;
  email: string;
  display_name: string | null;
  role: "member";
  status: string;
  expires_at: string | null;
  created_at: string | null;
};

type StorePreference = {
  id: string | null;
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
  invitations?: Invitation[];
  currentUserId: string;
  currentRole: MemberRole;
};

const editableRoles: Array<{ value: "admin" | "member"; label: string; description: string }> = [
  { value: "admin", label: "Eier/admin", description: "Kan administrere husholdning, medlemmer og butikkvalg" },
  { value: "member", label: "Medlem", description: "Kan bruke appen normalt. Barn behandles som medlem foreløpig." }
];

const priceSourceOptions: Array<{ key: PriceSourcePreferenceKey; label: string; description: string; recommended?: boolean }> = [
  {
    key: "include_kassalapp",
    label: "Offentlige prisdata",
    description: "Prisdata fra eksterne kilder. Gir verdi før husholdningen har mange egne priser.",
    recommended: true
  },
  {
    key: "include_own_shelf_edge",
    label: "Egne produktskann og manuelle priser",
    description: "Priser dere selv har registrert ved å skanne produkt eller skrive pris.",
    recommended: true
  },
  {
    key: "include_own_receipt",
    label: "Egne kvitteringspriser",
    description: "Priser hentet fra egne kvitteringer.",
    recommended: true
  },
  {
    key: "include_other_shelf_edge",
    label: "Delte produktskann fra andre",
    description: "Crowdsourcede prisobservasjoner fra andre husholdninger.",
    recommended: true
  },
  {
    key: "include_other_receipt",
    label: "Delte kvitteringspriser fra andre",
    description: "Anonymiserte priser fra andres kvitteringer.",
    recommended: true
  },
  {
    key: "include_own_manual",
    label: "Egne manuelle priser",
    description: "Manuelle priser fra denne husholdningen.",
    recommended: true
  },
  {
    key: "include_other_manual",
    label: "Manuelle priser fra andre",
    description: "Delte manuelle priser fra andre husholdninger.",
    recommended: false
  }
];

const preferredStoreKeys = new Set(["kiwi", "rema_1000", "meny_no", "spar_no", "joker_no", "bunnpris", "coop_no"]);
const onlineStoreKeys = new Set(["oda_no", "engrossnett_no"]);

function normalizeRole(role: MemberRole): "admin" | "member" {
  return role === "admin" ? "admin" : "member";
}

function roleLabel(role: MemberRole) {
  return role === "admin" ? "Eier/admin" : "Medlem";
}

function roleClass(role: MemberRole) {
  if (role === "admin") return "bg-emerald-50 text-brand ring-emerald-100";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function priorityLabel(priority: number | null) {
  const value = priority ?? 100;
  if (value <= 25) return "Favoritt";
  if (value <= 100) return "Normal";
  return "Lav";
}

function priorityValue(label: string) {
  if (label === "favorite") return 10;
  if (label === "low") return 200;
  return 100;
}

function daysLeft(value: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export default function AdminPage() {
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [householdName, setHouseholdName] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState("0");
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
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
      const result = await response.json().catch(() => null) as { data?: { stores?: StorePreference[] }; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke hente butikkoppsett");
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
      const result = await response.json().catch(() => null) as { data?: PriceSourcePreferences; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke hente priskildevalg");
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
      const result = await response.json().catch(() => null) as { data?: AdminPayload; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? "Kunne ikke hente admin-data");
      const data = result.data;
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
        body: JSON.stringify({ name: householdName.trim(), monthly_budget: monthlyBudget })
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke lagre husholdning");
      setMessage("Husholdningen er oppdatert.");
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre husholdning");
    } finally {
      setSaving(null);
    }
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setError("Skriv inn en gyldig e-postadresse.");
      return;
    }

    setSaving("invite-member");
    setError(null);
    setMessage(null);
    try {
      const response = await authFetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, display_name: newDisplayName.trim(), role: "member" })
      });
      const result = await response.json().catch(() => null) as { data?: { message?: string }; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke sende invitasjon");
      setNewEmail("");
      setNewDisplayName("");
      setMessage(result?.data?.message ?? "Invitasjon sendt. Personen blir medlem når invitasjonen godkjennes.");
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke sende invitasjon");
    } finally {
      setSaving(null);
    }
  }

  async function handleInvitation(invitation: PendingInvitation, action: "resend" | "cancel") {
    const label = action === "resend" ? "sende invitasjonen på nytt" : "avbryte invitasjonen";
    if (action === "cancel" && !window.confirm(`Avbryte invitasjonen til ${invitation.email}?`)) return;

    setSaving(`${action}-invite-${invitation.id}`);
    setError(null);
    setMessage(null);

    try {
      const response = await authFetch(`/api/admin/invitations/${invitation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error ?? `Kunne ikke ${label}`);
      }

      setMessage(result?.data?.message ?? (action === "resend" ? "Invitasjonen er sendt på nytt." : "Invitasjonen er avbrutt."));
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Kunne ikke ${label}`);
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
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke oppdatere medlem");
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
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke fjerne medlem");
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
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke lagre butikkoppsett");
      await loadStores();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre butikkoppsett");
      await loadStores();
    } finally {
      setSaving(null);
    }
  }

  async function setStorePreset(preset: "common" | "all" | "physical") {
    setSaving(`store-preset-${preset}`);
    setError(null);
    setMessage(null);
    try {
      const updates = stores.map((store) => {
        const key = store.store_key;
        if (preset === "all") return { ...store, is_enabled: true, priority: store.priority ?? 100 };
        if (preset === "physical") return { ...store, is_enabled: !onlineStoreKeys.has(key), priority: preferredStoreKeys.has(key) ? 50 : 150 };
        return { ...store, is_enabled: preferredStoreKeys.has(key), priority: preferredStoreKeys.has(key) ? 50 : 200 };
      });
      setStores(updates);
      for (const store of updates) {
        await authFetch("/api/admin/stores", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store_key: store.store_key,
            store_name: store.store_name,
            priority: store.priority ?? 100,
            is_enabled: store.is_enabled !== false
          })
        });
      }
      setMessage("Butikkvalget er oppdatert.");
      await loadStores();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre butikkvalg");
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
      const result = await response.json().catch(() => null) as { data?: PriceSourcePreferences; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke lagre priskildevalg");
      setPriceSourcePreferences(result?.data ?? nextPreferences);
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
  const pendingInvites = payload?.invitations?.filter((invite) => invite.status === "pending") ?? [];
  const activeStores = stores.filter((store) => store.is_enabled !== false);
  const disabledStores = stores.filter((store) => store.is_enabled === false);
  const setupSteps = [
    { label: "Husholdning", done: Boolean(payload?.household.name), detail: payload?.household.name || "Gi husholdningen et navn" },
    { label: "Medlemmer", done: (payload?.members.length ?? 0) > 1, detail: `${payload?.members.length ?? 0} aktive · ${pendingInvites.length} invitasjon${pendingInvites.length === 1 ? "" : "er"}` },
    { label: "Butikker", done: activeStores.length > 0, detail: `${activeStores.length} synlige butikker` },
    { label: "Basisvarer", done: false, detail: "Start med skann hjemme" }
  ];

  return (
    <AppShell active="Admin">
      <div className="space-y-6">
        <section className="rounded-[2rem] bg-slate-950 p-5 text-white shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">Husholdningsoppsett</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Admin og kom i gang</h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-200">
                Én enkel side for eier/admin: navn på husholdning, invitasjoner, butikkvalg og priskilder. Medlemmer inviteres alltid på e-post og må godkjenne selv.
              </p>
            </div>
            <button onClick={loadAdmin} disabled={loading} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-60">
              {loading ? "Laster..." : "Oppdater"}
            </button>
          </div>
        </section>

        {message ? <p className="notice-success">{message}</p> : null}
        {error ? <p className="notice-error">{error}</p> : null}

        {loading && !payload ? (
          <section className="card p-6 text-sm text-muted">Laster husholdningsoppsett...</section>
        ) : null}

        {payload ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
              <StatCard title="Husholdning" value={payload.household.name} subtitle="Aktiv husholdning" />
              <StatCard title="Medlemmer" value={String(payload.members.length)} subtitle={`${pendingInvites.length} ventende invitasjon${pendingInvites.length === 1 ? "" : "er"}`} tone="blue" />
              <StatCard title="Butikker" value={String(activeStores.length)} subtitle={`${disabledStores.length} skjult${disabledStores.length === 1 ? "" : "e"}`} tone="amber" />
              <StatCard title="Din rolle" value={roleLabel(payload.currentRole)} subtitle="Innlogget bruker" tone="purple" />
            </div>

            <section className="card p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="section-title">Kom i gang</h2>
                  <p className="section-subtitle">Dette er den praktiske sjekklisten for å gjøre husholdningen brukbar.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/mobile2" className="rounded-2xl bg-brand px-4 py-3 text-sm font-black text-white">Skann hjemmevarer</Link>
                  <Link href="/products" className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-black text-slate-700">Se basisvarer</Link>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {setupSteps.map((step, index) => (
                  <div key={step.label} className={`rounded-2xl border p-4 ${step.done ? "border-emerald-100 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{index + 1}. {step.done ? "OK" : "Neste"}</p>
                    <p className="mt-2 text-sm font-black text-slate-950">{step.label}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{step.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <main className="space-y-6">
                <section className="card p-5 sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="section-title">Butikker</h2>
                      <p className="section-subtitle">Velg butikkene som er relevante for husholdningen. Dette styrer prissammenligning og anbefalinger.</p>
                    </div>
                    <button type="button" onClick={loadStores} disabled={storesLoading} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-brand disabled:opacity-60">
                      {storesLoading ? "Laster" : "Oppdater"}
                    </button>
                  </div>

                  <div className="mt-5 grid gap-2 sm:grid-cols-3">
                    <button type="button" disabled={saving === "store-preset-common"} onClick={() => setStorePreset("common")} className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-brand ring-1 ring-emerald-100 disabled:opacity-60">Vanlige butikker</button>
                    <button type="button" disabled={saving === "store-preset-physical"} onClick={() => setStorePreset("physical")} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 ring-1 ring-slate-200 disabled:opacity-60">Fysiske butikker</button>
                    <button type="button" disabled={saving === "store-preset-all"} onClick={() => setStorePreset("all")} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 ring-1 ring-slate-200 disabled:opacity-60">Vis alle</button>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {stores.map((store) => {
                      const enabled = store.is_enabled !== false;
                      const savingThis = saving === `store-${store.store_key}`;
                      return (
                        <article key={store.store_key} className={`rounded-3xl border p-4 transition ${enabled ? "border-emerald-100 bg-emerald-50/70" : "border-slate-200 bg-white"}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-base font-black text-slate-950">{store.store_name}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">{enabled ? "Synlig i prisvalg" : "Skjult"} · {priorityLabel(store.priority)}</p>
                            </div>
                            <button
                              type="button"
                              disabled={savingThis}
                              onClick={() => updateStore(store, { is_enabled: !enabled })}
                              className={`rounded-full px-3 py-1 text-xs font-black ${enabled ? "bg-brand text-white" : "bg-slate-100 text-slate-600"} disabled:opacity-60`}
                            >
                              {enabled ? "På" : "Av"}
                            </button>
                          </div>

                          <label className="mt-4 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                            Prioritet
                            <select
                              value={(store.priority ?? 100) <= 25 ? "favorite" : (store.priority ?? 100) > 100 ? "low" : "normal"}
                              disabled={savingThis || !enabled}
                              onChange={(event) => updateStore(store, { priority: priorityValue(event.target.value) })}
                              className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-brand disabled:opacity-50"
                            >
                              <option value="favorite">Favoritt</option>
                              <option value="normal">Normal</option>
                              <option value="low">Lav</option>
                            </select>
                          </label>
                        </article>
                      );
                    })}

                    {!stores.length ? (
                      <p className="rounded-xl bg-slate-50 p-4 text-sm text-muted">Ingen butikker funnet ennå. Trykk Oppdater eller synk priser først.</p>
                    ) : null}
                  </div>
                </section>

                <section className="card p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="section-title">Priskilder</h2>
                      <p className="section-subtitle">Velg hvilke prisdata som skal brukes i sammenligning. Anbefalt oppsett er på som standard.</p>
                    </div>
                    <button type="button" onClick={loadPriceSourcePreferences} disabled={priceSourcePreferencesLoading} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-brand disabled:opacity-60">
                      {priceSourcePreferencesLoading ? "Laster" : "Oppdater"}
                    </button>
                  </div>

                  {priceSourcePreferences ? (
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {priceSourceOptions.map((option) => (
                        <label key={option.key} className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4">
                          <input
                            type="checkbox"
                            checked={priceSourcePreferences[option.key] !== false}
                            disabled={saving === `price-source-${option.key}`}
                            onChange={(event) => updatePriceSourcePreference(option.key, event.target.checked)}
                            className="mt-1"
                          />
                          <span>
                            <span className="block text-sm font-black text-slate-900">{option.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-muted">{option.description}</span>
                            {option.recommended ? <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-brand">Anbefalt</span> : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-muted">Ingen priskildevalg funnet ennå. Trykk Oppdater.</p>
                  )}
                </section>
              </main>

              <aside className="space-y-6">
                <section className="card p-5 sm:p-6">
                  <h2 className="section-title">Husholdning</h2>
                  <p className="section-subtitle">Navnet vises i toppen av appen. Budsjett er foreløpig valgfritt.</p>
                  <form onSubmit={saveHousehold} className="mt-5 space-y-4">
                    <label className="block text-sm font-bold text-slate-700">
                      Navn
                      <input
                        value={householdName}
                        onChange={(event) => setHouseholdName(event.target.value)}
                        placeholder="Hjemme"
                        className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                      />
                    </label>
                    <label className="block text-sm font-bold text-slate-700">
                      Månedlig budsjett
                      <input
                        value={monthlyBudget}
                        onChange={(event) => setMonthlyBudget(event.target.value)}
                        inputMode="decimal"
                        className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                      />
                    </label>
                    <button disabled={saving === "household" || !householdName.trim()} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                      {saving === "household" ? "Lagrer..." : "Lagre husholdning"}
                    </button>
                  </form>
                </section>

                <section className="card p-5 sm:p-6">
                  <h2 className="section-title">Inviter medlemmer</h2>
                  <p className="section-subtitle">Skriv e-post. Personen får invitasjon og blir først medlem når lenken er godkjent.</p>
                  <form onSubmit={inviteMember} className="mt-5 space-y-4">
                    <label className="block text-sm font-bold text-slate-700">
                      E-post
                      <input
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                        type="email"
                        required
                        placeholder="navn@eksempel.no"
                        className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                      />
                    </label>
                    <label className="block text-sm font-bold text-slate-700">
                      Navn i husholdningen
                      <input
                        value={newDisplayName}
                        onChange={(event) => setNewDisplayName(event.target.value)}
                        placeholder="Valgfritt"
                        className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
                      />
                    </label>
                    <button disabled={saving === "invite-member" || !newEmail.trim()} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                      {saving === "invite-member" ? "Sender..." : "Send invitasjon"}
                    </button>
                  </form>

                  {pendingInvites.length ? (
                    <div className="mt-5 space-y-2">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Venter på godkjenning</p>
                      {pendingInvites.map((invite) => {
                        const left = daysLeft(invite.expires_at);
                        const resendKey = `resend-invite-${invite.id}`;
                        const cancelKey = `cancel-invite-${invite.id}`;
                        return (
                          <div key={invite.id} className="rounded-2xl bg-slate-50 p-3 text-sm">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-black text-slate-900">{invite.email}</p>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                  {left === null ? "Invitasjon sendt" : left >= 0 ? `Utløper om ${left} dager` : "Utløpt"}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleInvitation(invite, "resend")}
                                  disabled={saving === resendKey || saving === cancelKey}
                                  className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-brand disabled:opacity-60"
                                >
                                  {saving === resendKey ? "Sender..." : "Send på nytt"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleInvitation(invite, "cancel")}
                                  disabled={saving === resendKey || saving === cancelKey}
                                  className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-600 disabled:opacity-60"
                                >
                                  {saving === cancelKey ? "Avbryter..." : "Avbryt"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>

                <section className="card overflow-hidden">
                  <div className="border-b border-line p-5">
                    <h2 className="section-title">Aktive medlemmer</h2>
                    <p className="text-sm leading-6 text-muted">Barn og medlem behandles likt foreløpig. Rollen kan endres etter at invitasjonen er godtatt.</p>
                  </div>
                  <div className="divide-y divide-line">
                    {payload.members.map((member) => (
                      <article key={member.id} className="p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            defaultValue={member.display_name}
                            onBlur={(event) => {
                              const value = event.target.value.trim();
                              if (value && value !== member.display_name) updateMember(member.id, { display_name: value });
                            }}
                            className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm font-semibold outline-none focus:border-brand"
                          />
                          {member.is_current_user ? <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">Deg</span> : null}
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${roleClass(member.role)}`}>{roleLabel(member.role)}</span>
                        </div>
                        <p className="mt-2 text-sm text-muted">{member.email ?? "E-post ikke funnet"}</p>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <select
                            value={normalizeRole(member.role)}
                            disabled={saving === member.id}
                            onChange={(event) => updateMember(member.id, { role: event.target.value as "admin" | "member" })}
                            className="rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
                          >
                            {editableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                          </select>
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
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
