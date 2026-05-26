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

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
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
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}${safeNext()}` }
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    setMessage("Sjekk e-posten din for å bekrefte kontoen.");
  }

  async function sendMagicLink() {
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
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
