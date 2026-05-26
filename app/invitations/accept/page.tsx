"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
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

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextPath = `/invitations/accept?token=${encodeURIComponent(token)}`;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (!token) throw new Error("Invitasjonslenken mangler token.");
      const response = await fetch(`/api/household/invitations/accept?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as { data?: InvitationInfo; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error ?? "Invitasjonen finnes ikke eller er utløpt.");
      setInfo(result.data);

      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email?.toLowerCase() ?? null;
      setSessionEmail(email);

      if (email && result.data.email && email !== result.data.email.toLowerCase()) {
        await supabase.auth.signOut();
        window.localStorage.removeItem("matmakt.activeHouseholdId");
        setSessionEmail(null);
        setMessage(`Du var logget inn med ${email}. Logg inn med ${result.data.email} for å godkjenne invitasjonen.`);
      }
    } catch (err) {
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
    try {
      const response = await authFetch("/api/household/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const result = await response.json().catch(() => null) as { data?: { household_id?: string }; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Kunne ikke godkjenne invitasjonen.");
      if (result?.data?.household_id) window.localStorage.setItem("matmakt.activeHouseholdId", result.data.household_id);
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

  const needsLogin = Boolean(info && !sessionEmail);
  const canAccept = Boolean(info && sessionEmail && sessionEmail === info.email.toLowerCase() && info.status !== "expired");

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4">
      <section className="w-full max-w-2xl rounded-[2rem] border border-line bg-white p-8 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-brand">Matmakt</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">Invitasjon til husholdning</h1>

        {loading ? <p className="mt-6 text-lg font-bold text-muted">Laster invitasjon...</p> : null}
        {error ? <p className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</p> : null}
        {message ? <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-brand">{message}</p> : null}

        {info ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-3xl bg-slate-50 p-5">
              <p className="text-sm font-semibold text-muted">Du er invitert til</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{info.household_name ?? "en husholdning"}</p>
              <p className="mt-3 text-sm font-semibold text-slate-600">Invitasjonen gjelder: {info.email}</p>
            </div>

            {needsLogin ? (
              <Link href={`/login?email=${encodeURIComponent(info.email)}&next=${encodeURIComponent(nextPath)}`} className="inline-flex rounded-2xl bg-brand px-5 py-4 text-sm font-black text-white">
                Logg inn med riktig e-post
              </Link>
            ) : null}

            {canAccept ? (
              <button onClick={accept} disabled={accepting} className="rounded-2xl bg-brand px-5 py-4 text-sm font-black text-white disabled:opacity-60">
                {accepting ? "Godkjenner..." : "Godkjenn invitasjon"}
              </button>
            ) : null}

            <div>
              <Link href="/login" className="text-sm font-bold text-brand underline">Gå til innlogging</Link>
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
