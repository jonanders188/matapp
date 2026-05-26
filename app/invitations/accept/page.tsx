"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AcceptStatus = "checking" | "login" | "accepting" | "accepted" | "error";

type InvitationInfo = {
  household_id: string;
  household_name: string;
  invited_email: string;
  status: string;
  expires_at?: string | null;
};

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export default function AcceptInvitationPage() {
  const [status, setStatus] = useState<AcceptStatus>("checking");
  const [message, setMessage] = useState("Sjekker invitasjonen...");
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [invitationInfo, setInvitationInfo] = useState<InvitationInfo | null>(null);

  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
  }, []);

  const loginHref = `/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setStatus("error");
        setMessage("Invitasjonslenken mangler token. Be om en ny invitasjon.");
        return;
      }

      const infoResponse = await fetch(`/api/household-invitations/accept?token=${encodeURIComponent(token)}`, {
        cache: "no-store"
      });
      const infoPayload = await infoResponse.json().catch(() => null) as { data?: InvitationInfo; error?: string } | null;

      if (!infoResponse.ok || !infoPayload?.data) {
        throw new Error(infoPayload?.error ?? "Invitasjonen finnes ikke eller er utløpt");
      }

      const info = infoPayload.data;
      if (!cancelled) setInvitationInfo(info);

      if (info.status === "expired") {
        setStatus("error");
        setMessage("Invitasjonen er utløpt. Be om en ny invitasjon.");
        return;
      }

      if (info.status !== "pending" && info.status !== "accepted") {
        setStatus("error");
        setMessage("Invitasjonen er ikke aktiv lenger. Be om en ny invitasjon.");
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const sessionEmail = normalizeEmail(data.session?.user?.email);
      const invitedEmail = normalizeEmail(info.invited_email);

      if (data.session && sessionEmail && sessionEmail !== invitedEmail) {
        // Viktig: hvis man klikker en invitasjon mens man er logget inn med feil konto,
        // må vi ikke forsøke å godkjenne invitasjonen med den kontoen. Logg ut først,
        // rydd aktiv husholdning og be bruker logge inn med e-posten invitasjonen gjelder.
        await supabase.auth.signOut();
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("matmakt.activeHouseholdId");
        }
        if (!cancelled) {
          setStatus("login");
          setMessage(`Du var logget inn som ${sessionEmail}. Denne invitasjonen gjelder ${invitedEmail}. Logg inn med riktig e-post for å godkjenne.`);
        }
        return;
      }

      if (!data.session) {
        if (!cancelled) {
          setStatus("login");
          setMessage(`Logg inn med ${invitedEmail} for å godkjenne invitasjonen til ${info.household_name}.`);
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
      const payload = await response.json().catch(() => null) as { data?: { household_id?: string; alreadyAccepted?: boolean }; error?: string } | null;

      if (response.status === 401) {
        if (!cancelled) {
          setStatus("login");
          setMessage("Innloggingen er utløpt. Logg inn igjen med e-posten invitasjonen ble sendt til.");
        }
        return;
      }

      if (response.status === 403) {
        await supabase.auth.signOut();
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("matmakt.activeHouseholdId");
        }
        if (!cancelled) {
          setStatus("login");
          setMessage(payload?.error ?? `Logg inn med ${invitedEmail} for å godkjenne invitasjonen.`);
        }
        return;
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? "Kunne ikke godkjenne invitasjonen");
      }

      const nextHouseholdId = payload?.data?.household_id ?? info.household_id ?? null;
      if (nextHouseholdId && typeof window !== "undefined") {
        window.localStorage.setItem("matmakt.activeHouseholdId", nextHouseholdId);
      }

      if (!cancelled) {
        setHouseholdId(nextHouseholdId);
        setStatus("accepted");
        setMessage(payload?.data?.alreadyAccepted ? "Invitasjonen er allerede godkjent. Medlemskapet er aktivt." : `Invitasjonen er godkjent. Du er lagt til i ${info.household_name}.`);
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

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4">
      <section className="w-full max-w-lg rounded-3xl border border-line bg-white p-8 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-emerald-700">Matmakt</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">Invitasjon til husholdning</h1>
        {invitationInfo?.household_name ? (
          <p className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm font-black text-emerald-800">
            {invitationInfo.household_name} · {invitationInfo.invited_email}
          </p>
        ) : null}
        <p className="mt-4 text-lg font-semibold leading-relaxed text-slate-600">{message}</p>

        {status === "login" ? (
          <a href={loginHref} className="mt-8 inline-flex rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-soft">
            Logg inn og godkjenn
          </a>
        ) : null}

        {status === "accepted" ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={householdId ? "/dashboard" : "/onboarding"} className="rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-soft">
              Fortsett
            </a>
            <a href="/dashboard" className="rounded-2xl border border-line px-6 py-4 text-base font-black text-slate-900">
              Gå til dashboard
            </a>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={loginHref} className="inline-flex rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-soft">
              Logg inn på nytt
            </a>
            <a href="/dashboard" className="inline-flex rounded-2xl border border-line px-6 py-4 text-base font-black text-slate-900">
              Til dashboard
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}
