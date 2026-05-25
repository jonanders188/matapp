"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Mode = "login" | "signup";

function friendlyAuthError(message: string) {
  if (message.toLowerCase().includes("invalid login credentials")) return "Feil e-post eller passord.";
  if (message.toLowerCase().includes("password should be")) return "Passordet må være minst 6 tegn.";
  return message;
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUsePassword = Boolean(email.trim()) && password.length >= 6;

  function onboardingUrl() {
    return `${window.location.origin}/onboarding`;
  }

  function setPasswordUrl() {
    return `${window.location.origin}/set-password`;
  }

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();

    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: onboardingUrl() }
      });

      setLoading(false);
      if (signUpError) {
        setError(friendlyAuthError(signUpError.message));
        return;
      }

      setMessage("Sjekk e-posten din for å bekrefte kontoen. Etterpå kan du logge inn med passord.");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (signInError) {
      setError(friendlyAuthError(signInError.message));
      return;
    }

    window.location.href = "/onboarding";
  }

  async function sendMagicLink() {
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: onboardingUrl()
      }
    });

    setLoading(false);
    if (otpError) {
      setError(friendlyAuthError(otpError.message));
      return;
    }

    setMessage("Sjekk e-posten din. Der ligger innloggingslenken til Matmakt.");
  }

  async function sendPasswordReset() {
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: setPasswordUrl()
    });

    setLoading(false);
    if (resetError) {
      setError(friendlyAuthError(resetError.message));
      return;
    }

    setMessage("Sjekk e-posten din. Der ligger lenke for å sette nytt passord.");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4">
      <section className="w-full max-w-md rounded-3xl border border-line bg-white p-8 shadow-soft">
        <div className="mb-8 flex items-center gap-3 text-xl font-bold text-brand">
          <img src="/brand/matmakt-mark.svg" alt="" className="h-12 w-12" />
          <div>
            <p className="text-2xl font-black text-slate-950">Matmakt</p>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Bygg. Sammenlign. Spar.</p>
          </div>
        </div>

        <h1 className="page-heading">{mode === "login" ? "Logg inn" : "Opprett konto"}</h1>
        <p className="mt-2 text-sm text-muted">
          Du kan bruke Matmakt anonymt. Vi trenger bare e-post for innlogging og sikkerhet.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 text-sm font-black">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-xl px-3 py-3 ${mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
          >
            Logg inn
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-xl px-3 py-3 ${mode === "signup" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
          >
            Ny konto
          </button>
        </div>

        <form onSubmit={signInWithPassword} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            E-post
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              required
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Passord
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </label>

          {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}

          <button disabled={loading || !canUsePassword} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? "Jobber..." : mode === "login" ? "Logg inn med passord" : "Opprett konto med passord"}
          </button>
          <button type="button" onClick={sendMagicLink} disabled={loading || !email} className="w-full rounded-xl border border-line px-4 py-3 text-sm font-semibold text-brand disabled:opacity-60">
            Send magic link
          </button>
          <button type="button" onClick={sendPasswordReset} disabled={loading || !email} className="w-full px-4 py-2 text-sm font-semibold text-slate-500 disabled:opacity-60">
            Sett eller glemt passord?
          </button>
        </form>
      </section>
    </main>
  );
}
