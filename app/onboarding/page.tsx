"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { authFetch } from "@/lib/auth-fetch";

type MemberRole = "admin" | "member" | "child";

type Household = {
  id: string;
  name: string;
  monthly_budget: number | null;
  created_at: string | null;
};

type Member = {
  id: string;
  user_id: string;
  display_name: string;
  role: MemberRole;
  email: string | null;
  created_at: string | null;
  is_current_user?: boolean;
};

type AdminPayload = {
  household: Household;
  members: Member[];
  currentUserId: string;
  currentRole: MemberRole;
};

type OnboardingStatus = {
  household_id: string;
  role: MemberRole;
  basis_count: number;
  inventory_count: number;
  onboarding_complete: boolean;
};

const basisPlaces = ["Kjøleskap", "Fryser", "Skuffer", "Skap"] as const;

function roleLabel(role: MemberRole) {
  if (role === "admin") return "Eier";
  return "Medlem";
}

function roleClass(role: MemberRole) {
  if (role === "admin") return "bg-emerald-50 text-emerald-800 ring-emerald-100";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceOnboarding = searchParams.get("force") === "1";
  const inviteToken = searchParams.get("invite_token");
  const householdIdFromUrl = searchParams.get("household_id");

  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [householdName, setHouseholdName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const memberCount = payload?.members.length ?? 0;
  const isAdmin = payload?.currentRole === "admin";
  const basisCount = status?.basis_count ?? 0;
  const inventoryCount = status?.inventory_count ?? 0;
  const onboardingComplete = Boolean(status?.onboarding_complete);

  const inviteText = useMemo(() => {
    const name = payload?.household.name || "husholdningen min";
    return `Bli med i ${name} på Matmakt. Du får en e-postinvitasjon og blir medlem først når du godkjenner selv.`;
  }, [payload?.household.name]);

  async function acceptInvitation(token: string) {
    const response = await authFetch("/api/household/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const result = await response.json().catch(() => null) as { data?: { household_id?: string }; error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "Kunne ikke godkjenne invitasjonen.");
    if (result?.data?.household_id) {
      window.localStorage.setItem("matmakt.activeHouseholdId", result.data.household_id);
      setMessage("Invitasjonen er godtatt. Du er nå koblet til husholdningen.");
    }
  }

  async function ensureHousehold() {
    const response = await authFetch("/api/onboarding/ensure-household", { method: "POST" });
    const result = await response.json().catch(() => null) as { data?: { household_id?: string }; error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "Kunne ikke klargjøre husholdningen.");
    if (result?.data?.household_id) {
      window.localStorage.setItem("matmakt.activeHouseholdId", result.data.household_id);
    }
  }

  async function loadStatus() {
    const response = await authFetch("/api/onboarding/status", { cache: "no-store" });
    const result = await response.json().catch(() => null) as { data?: OnboardingStatus; error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "Kunne ikke hente onboarding-status.");
    setStatus(result?.data ?? null);
    return result?.data ?? null;
  }

  async function loadHousehold() {
    const response = await authFetch("/api/admin/household", { cache: "no-store" });
    const result = await response.json().catch(() => null) as { data?: AdminPayload; error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "Kunne ikke hente husholdningen.");
    const data = result?.data ?? null;
    setPayload(data);
    setHouseholdName(data?.household.name ?? "");
    return data;
  }

  async function boot() {
    setLoading(true);
    setError(null);

    try {
      if (inviteToken) {
        await acceptInvitation(inviteToken);
      } else if (householdIdFromUrl) {
        window.localStorage.setItem("matmakt.activeHouseholdId", householdIdFromUrl);
      }

      try {
        await loadHousehold();
      } catch (householdError) {
        const text = householdError instanceof Error ? householdError.message.toLowerCase() : "";
        if (text.includes("ikke medlem") || text.includes("husholdning")) {
          await ensureHousehold();
          await loadHousehold();
        } else {
          throw householdError;
        }
      }

      const currentStatus = await loadStatus();
      if (currentStatus?.onboarding_complete && !forceOnboarding && !inviteToken) {
        router.replace("/dashboard");
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke åpne onboarding.");
    } finally {
      setLoading(false);
    }
  }

  async function saveHousehold(event: React.FormEvent) {
    event.preventDefault();
    if (!householdName.trim()) return;
    setSaving("household");
    setMessage(null);
    setError(null);

    try {
      const response = await authFetch("/api/admin/household", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: householdName.trim(), monthly_budget: payload?.household.monthly_budget ?? 0 })
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke lagre husholdningen.");
      setMessage("Husholdningen er oppdatert.");
      await loadHousehold();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre husholdningen.");
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

    setSaving("member");
    setMessage(null);
    setError(null);

    try {
      const response = await authFetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, display_name: newDisplayName.trim(), role: "member" })
      });
      const result = await response.json().catch(() => null) as { data?: { message?: string }; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke sende invitasjon.");
      setNewEmail("");
      setNewDisplayName("");
      setMessage(result?.data?.message ?? "Invitasjon sendt. Personen blir medlem når invitasjonen godkjennes.");
      await loadHousehold();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke sende invitasjon.");
    } finally {
      setSaving(null);
    }
  }

  async function copyInviteText() {
    try {
      await navigator.clipboard.writeText(inviteText);
      setMessage("Invitasjonstekst kopiert.");
    } catch {
      setError("Kunne ikke kopiere. Kopier teksten manuelt.");
    }
  }

  useEffect(() => {
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell active="Kom i gang">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-[2rem] bg-slate-950 p-5 text-white shadow-sm sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">Matmakt start</p>
          <div className="mt-4 grid gap-5 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-5xl">
                {onboardingComplete ? "Du er allerede i gang" : "Kom i gang med basisvarene"}
              </h1>
              <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-200">
                Kom i gang vises bare når husholdningen mangler det viktigste. Start med å skanne varene dere allerede har hjemme. Ingen pris er nødvendig.
              </p>
            </div>
            <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/10">
              <p className="text-sm font-semibold text-slate-200">Status</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {loading ? "Sjekker husholdningen..." : `${basisCount} basisvarer · ${inventoryCount} lagerlinjer · ${memberCount} medlem${memberCount === 1 ? "" : "mer"}`}
              </p>
            </div>
          </div>
        </section>

        {message ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{message}</p> : null}
        {error ? <p className="rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}

        {loading ? (
          <section className="rounded-[2rem] bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">Laster onboarding...</section>
        ) : null}

        {!loading && onboardingComplete ? (
          <section className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Fullført</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Husholdningen har basisvarer</h2>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              Denne siden trenger dere normalt ikke lenger. Gå til dashboard for nåsituasjonen, eller skann flere hjemmevarer når dere vil utvide basisvarene.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/dashboard" className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white">Til dashboard</Link>
              <Link href="/mobile2" className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-800">Skann flere hjemmevarer</Link>
              {isAdmin ? <Link href="/admin" className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-800">Administrer husholdning</Link> : null}
            </div>
          </section>
        ) : null}

        {!loading && !onboardingComplete ? (
          <>
            <section className="grid gap-4 lg:grid-cols-3">
              <article className="rounded-[2rem] border border-emerald-100 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">1. Husholdning</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">{payload?.household.name || "Hjemme"}</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  Matmakt bruker husholdningen for lager, basisvarer og delte prisvalg.
                </p>
                {isAdmin ? (
                  <form onSubmit={saveHousehold} className="mt-4 space-y-3">
                    <input
                      value={householdName}
                      onChange={(event) => setHouseholdName(event.target.value)}
                      placeholder="Min husholdning"
                      className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base font-semibold outline-none focus:border-emerald-600"
                    />
                    <button type="submit" disabled={saving === "household"} className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                      {saving === "household" ? "Lagrer..." : "Lagre navn"}
                    </button>
                  </form>
                ) : (
                  <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-600">Du er medlem. Eier/admin kan endre husholdningsnavn.</p>
                )}
              </article>

              <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">2. Medlemmer</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Inviter husholdningen</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  Invitasjoner sendes på e-post. Mottaker blir ikke medlem før invitasjonen godkjennes.
                </p>
                {isAdmin ? (
                  <form onSubmit={inviteMember} className="mt-4 space-y-3">
                    <input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="epost@eksempel.no" type="email" className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base font-semibold outline-none focus:border-emerald-600" />
                    <input value={newDisplayName} onChange={(event) => setNewDisplayName(event.target.value)} placeholder="Navn valgfritt" className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base font-semibold outline-none focus:border-emerald-600" />
                    <button type="submit" disabled={saving === "member"} className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                      {saving === "member" ? "Sender..." : "Send invitasjon"}
                    </button>
                  </form>
                ) : (
                  <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-600">Medlemmer kan skanne varer og kvitteringer, men kan ikke invitere andre.</p>
                )}
                <button type="button" onClick={copyInviteText} className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800">
                  Kopier enkel invitasjonstekst
                </button>
              </article>

              <article className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">3. Viktigste start</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Skann hjemmevarer</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                  Raskeste start er å skanne det dere allerede har. Varen legges på lager og blir basisvare helt til dere velger den bort.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {basisPlaces.map((place) => <span key={place} className="rounded-2xl bg-white px-3 py-3 text-center text-sm font-black text-emerald-800 ring-1 ring-emerald-100">{place}</span>)}
                </div>
                <Link href="/mobile2" className="mt-4 block rounded-2xl bg-emerald-700 px-4 py-4 text-center text-base font-black text-white">Start skanning hjemme</Link>
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
              <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Dagens husholdning</p>
                    <h2 className="mt-2 text-2xl font-black text-slate-950">{payload?.household.name || "Husholdning"}</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">{memberCount} medlem{memberCount === 1 ? "" : "mer"}</p>
                  </div>
                  {isAdmin ? <Link href="/admin" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800">Åpne admin</Link> : null}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {payload?.members.map((member) => (
                    <div key={member.id} className="rounded-2xl bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-950">{member.display_name || member.email || "Medlem"}</p>
                          <p className="truncate text-xs font-semibold text-slate-500">{member.email ?? "Ingen e-post vist"}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ring-1 ${roleClass(member.role)}`}>{roleLabel(member.role)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Slik virker kvittering senere</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Kvittering matcher basisvarer</h2>
                <ol className="mt-4 space-y-3 text-sm font-semibold leading-6 text-slate-600">
                  <li><span className="font-black text-slate-950">1.</span> Skann kvitteringen etter handel.</li>
                  <li><span className="font-black text-slate-950">2.</span> Matmakt matcher mot basisvarene deres.</li>
                  <li><span className="font-black text-slate-950">3.</span> Ukjente varer kan skannes etterpå.</li>
                  <li><span className="font-black text-slate-950">4.</span> Når en ukjent vare skannes, blir den basisvare.</li>
                </ol>
                <Link href="/mobile2" className="mt-4 block rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-black text-slate-800">Skann kvittering senere</Link>
              </article>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}


export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f6f7f5] p-6 text-slate-950">
          <div className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Matmakt</p>
            <h1 className="mt-3 text-3xl font-black">Laster kom i gang...</h1>
          </div>
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
