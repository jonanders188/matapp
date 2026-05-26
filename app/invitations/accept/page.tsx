"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/auth-fetch";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type InvitationInfo = {
  email: string;
  display_name: string | null;
  status: string;
  expires_at: string | null;
  household_id: string;
  household_name: string | null;
};

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => `/invitations/accept?token=${encodeURIComponent(token)}`, [token]);

  async function load() {
    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      if (!token) throw new Error("Invitasjonslenken mangler token.");

      const response = await fetch(`/api/household/invitations/accept?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as { data?: InvitationInfo; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? "Invitasjonen finnes ikke eller er utløpt.");

      const invitation = {
        ...result.data,
        email: normalizeEmail(result.data.email)
      };

      setInfo(invitation);

      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const email = normalizeEmail(data.session?.user?.email ?? null) || null;

      if (email && invitation.email && email !== invitation.email) {
        await supabase.auth.signOut();
        window.localStorage.removeItem("matmakt.activeHouseholdId");
        setSessionEmail(null);
        setWarning(`Du var logget inn med ${email}. Du må logge inn med ${invitation.email} for å godkjenne invitasjonen.`);
      } else {
        setSessionEmail(email);
      }
    } catch (err) {
      setInfo(null);
      setError(err instanceof Error ? err.message : "Kunne ikke åpne invitasjonen.");
    } finally {
      setLoading(false);
    }
  }

  async function accept() {
    if (!token) return;
    setAccepting(true);
    setError(null);
    setMessage(null);
    setWarning(null);

    try {
      const response = await authFetch("/api/household/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });

      const result = await response.json().catch(() => null) as { data?: { household_id?: string }; error?: string } | null;

      if (response.status === 401) {
        window.location.href = `/login?email=${encodeURIComponent(info?.email ?? "")}&next=${encodeURIComponent(nextPath)}`;
        return;
      }

      if (response.status === 409 && result?.error?.includes("riktig e-post")) {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.signOut();
        window.localStorage.removeItem("matmakt.activeHouseholdId");
        setSessionEmail(null);
        setWarning(result.error);
        return;
      }

      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke godkjenne invitasjonen.");

      if (result?.data?.household_id) {
        window.localStorage.setItem("matmakt.activeHouseholdId", result.data.household_id);
      }

      setMessage("Invitasjonen er godtatt. Du er nå medlem av husholdningen.");
      window.setTimeout(() => { window.location.href = "/dashboard"; }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke godkjenne invitasjonen.");
    } finally {
      setAccepting(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const inviteEmail = normalizeEmail(info?.email);
  const isExpired = info?.status === "expired";
  const isCancelled = info?.status === "cancelled";
  const isAccepted = info?.status === "accepted";
  const needsLogin = Boolean(info && !sessionEmail && !isExpired && !isCancelled);
  const canAccept = Boolean(info && sessionEmail && sessionEmail === inviteEmail && !isExpired && !isCancelled);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4">
      <section className="w-full max-w-2xl rounded-[2rem] border border-line bg-white p-8 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-brand">Matmakt</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">Invitasjon til husholdning</h1>

        {loading ? <p className="mt-6 text-lg font-bold text-muted">Laster invitasjon...</p> : null}
        {error ? <p className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</p> : null}
        {warning ? <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-800">{warning}</p> : null}
        {message ? <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-brand">{message}</p> : null}

        {info ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-3xl bg-slate-50 p-5">
              <p className="text-sm font-semibold text-muted">Du er invitert til</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{info.household_name ?? "en husholdning"}</p>
              <p className="mt-3 text-sm font-semibold text-slate-600">Invitasjonen gjelder: {info.email}</p>
              {isAccepted ? <p className="mt-3 text-sm font-bold text-emerald-700">Invitasjonen er allerede godkjent. Trykk godkjenn igjen hvis medlemskapet må repareres.</p> : null}
              {isExpired ? <p className="mt-3 text-sm font-bold text-rose-700">Invitasjonen er utløpt. Be husholdningsadmin sende en ny.</p> : null}
              {isCancelled ? <p className="mt-3 text-sm font-bold text-rose-700">Invitasjonen er avbrutt. Be husholdningsadmin sende en ny.</p> : null}
            </div>

            {needsLogin ? (
              <div className="space-y-3">
                <Link href={`/login?email=${encodeURIComponent(info.email)}&next=${encodeURIComponent(nextPath)}`} className="inline-flex rounded-2xl bg-brand px-5 py-4 text-sm font-black text-white">
                  Logg inn eller opprett konto med {info.email}
                </Link>
                <p className="text-sm font-semibold text-muted">Du kan bruke passord, magic link eller opprette konto på neste side. Etter innlogging kommer du tilbake hit.</p>
              </div>
            ) : null}

            {canAccept ? (
              <button onClick={accept} disabled={accepting} className="rounded-2xl bg-brand px-5 py-4 text-sm font-black text-white disabled:opacity-60">
                {accepting ? "Godkjenner..." : isAccepted ? "Reparer medlemskap" : "Godkjenn invitasjon"}
              </button>
            ) : null}

            <div className="flex flex-wrap gap-4">
              <button type="button" onClick={load} className="text-sm font-bold text-brand underline">Oppdater status</button>
              <Link href={`/login?email=${encodeURIComponent(info.email)}&next=${encodeURIComponent(nextPath)}`} className="text-sm font-bold text-brand underline">Gå til innlogging</Link>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4"><p className="text-sm font-bold text-muted">Laster invitasjon...</p></main>}>
      <AcceptInvitationContent />
    </Suspense>
  );
}
