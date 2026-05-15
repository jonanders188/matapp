"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    window.location.href = "/dashboard";
  }

  async function sendMagicLink() {
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`
      }
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
        <div className="mb-8 flex items-center gap-3 text-xl font-bold text-brand">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-soft">🛒</div>
          Husholdningspilot
        </div>

        <h1 className="text-3xl font-bold">Logg inn</h1>
        <p className="mt-2 text-sm text-muted">Bruk Supabase-brukeren som er medlem av husholdningen.</p>

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
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </label>

          {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}

          <button disabled={loading || !email || !password} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? "Logger inn..." : "Logg inn med passord"}
          </button>
          <button type="button" onClick={sendMagicLink} disabled={loading || !email} className="w-full rounded-xl border border-line px-4 py-3 text-sm font-semibold text-brand disabled:opacity-60">
            Send magic link
          </button>
        </form>
      </section>
    </main>
  );
}
