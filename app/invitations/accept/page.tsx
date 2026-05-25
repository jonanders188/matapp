"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AcceptInvitationPage() {
  const [status, setStatus] = useState<"checking" | "login" | "accepting" | "accepted" | "error">("checking");
  const [message, setMessage] = useState("Sjekker invitasjonen...");

  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setStatus("error");
        setMessage("Invitasjonslenken mangler token.");
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) {
          setStatus("login");
          setMessage("Logg inn med samme e-postadresse som invitasjonen ble sendt til. Deretter godkjennes invitasjonen automatisk.");
        }
        return;
      }

      if (!cancelled) {
        setStatus("accepting");
        setMessage("Godkjenner invitasjonen...");
      }

      const response = await authFetch("/api/household-invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? "Kunne ikke godkjenne invitasjonen");
      }

      const householdId = payload?.data?.household_id;
      if (householdId && typeof window !== "undefined") {
        window.localStorage.setItem("matmakt.activeHouseholdId", householdId);
      }

      if (!cancelled) {
        setStatus("accepted");
        setMessage("Invitasjonen er godkjent. Du er lagt til i husholdningen.");
      }
    }

    run().catch((error) => {
      if (!cancelled) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Ukjent feil");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const loginHref = `/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4">
      <section className="w-full max-w-lg rounded-3xl border border-line bg-white p-8 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-emerald-700">Matmakt</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">Invitasjon til husholdning</h1>
        <p className="mt-4 text-lg font-semibold leading-relaxed text-slate-600">{message}</p>

        {status === "login" ? (
          <a href={loginHref} className="mt-8 inline-flex rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-soft">
            Logg inn og godkjenn
          </a>
        ) : null}

        {status === "accepted" ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/onboarding" className="rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-soft">
              Fortsett
            </a>
            <a href="/dashboard" className="rounded-2xl border border-line px-6 py-4 text-base font-black text-slate-900">
              Gå til dashboard
            </a>
          </div>
        ) : null}

        {status === "error" ? (
          <a href="/login" className="mt-8 inline-flex rounded-2xl border border-line px-6 py-4 text-base font-black text-slate-900">
            Gå til innlogging
          </a>
        ) : null}
      </section>
    </main>
  );
}
