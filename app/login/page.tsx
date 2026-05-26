"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

function LoginContent() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const emailFromUrl = searchParams.get("email") || "";
  const [email, setEmail] = useState(emailFromUrl);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (emailFromUrl) setEmail(emailFromUrl);
  }, [emailFromUrl]);

  function safeNext() {
    return next.startsWith("/") ? next : "/dashboard";
  }

  function cleanEmail() {
    return email.trim().toLowerCase();
  }

  const isInvitationLogin = safeNext().startsWith("/invitations/accept");

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: cleanEmail(), password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    window.location.href = safeNext();
  }

  async function signUpWithPassword() {
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail(),
      password,
      options: { emailRedirectTo: `${window.location.origin}${safeNext()}` }
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (signUpData.session) {
      window.location.href = safeNext();
      return;
    }
    setMessage("Kontoen er opprettet. Sjekk e-posten din for å bekrefte kontoen. Etter bekreftelse kommer du tilbake til riktig sted. Sjekk også søppelpost hvis den ikke kommer frem.");
  }

  async function resendSignupConfirmation() {
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: cleanEmail(),
      options: { emailRedirectTo: `${window.location.origin}${safeNext()}` }
    });
    setLoading(false);
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setMessage("Ny bekreftelsesmail er sendt. Sjekk også søppelpost.");
  }

  async function sendPasswordReset() {
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail(), {
      redirectTo: `${window.location.origin}/set-password?next=${encodeURIComponent(safeNext())}`
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setMessage("Vi har sendt en lenke for å sette eller endre passord. Sjekk også søppelpost.");
  }

  async function sendMagicLink() {
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: cleanEmail(),
      options: { emailRedirectTo: `${window.location.origin}${safeNext()}` }
    });
    setLoading(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setMessage("Sjekk e-posten din for innloggingslenke.");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4">
      <section className="w-full max-w-md rounded-3xl border border-line bg-white p-8 shadow-soft">
        <div className="mb-8">
          <p className="text-3xl font-black text-brand">Matmakt</p>
          <p className="mt-2 text-sm font-semibold text-muted">Ta kontroll på basisvarene.</p>
        </div>
        <h1 className="page-heading">Logg inn</h1>
        <p className="mt-2 text-sm text-muted">Bruk e-post. Ved invitasjon må du logge inn med e-posten invitasjonen gjelder.</p>
        {isInvitationLogin ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-brand">Du er på vei inn via en husholdningsinvitasjon. Logg inn eller opprett konto med samme e-post som invitasjonen ble sendt til.</p> : null}
        <form onSubmit={signInWithPassword} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            E-post
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Passord
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand" />
          </label>
          {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}
          <button disabled={loading || !email || !password} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{loading ? "Logger inn..." : "Logg inn med passord"}</button>
          <button type="button" onClick={signUpWithPassword} disabled={loading || !email || !password} className="w-full rounded-xl border border-line px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60">Opprett konto med passord</button>
          <button type="button" onClick={sendMagicLink} disabled={loading || !email} className="w-full rounded-xl border border-line px-4 py-3 text-sm font-semibold text-brand disabled:opacity-60">Send magic link</button>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={resendSignupConfirmation} disabled={loading || !email} className="rounded-xl border border-line px-4 py-3 text-xs font-semibold text-slate-600 disabled:opacity-60">Send bekreftelse på nytt</button>
            <button type="button" onClick={sendPasswordReset} disabled={loading || !email} className="rounded-xl border border-line px-4 py-3 text-xs font-semibold text-slate-600 disabled:opacity-60">Sett / glemt passord</button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4"><p className="text-sm font-bold text-muted">Laster innlogging...</p></main>}>
      <LoginContent />
    </Suspense>
  );
}
