"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 6) {
      setError("Passordet må være minst 6 tegn.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passordene er ikke like.");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Passordet er lagret. Du kan nå gå videre til Matmakt.");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-4">
      <section className="w-full max-w-md rounded-3xl border border-line bg-white p-8 shadow-soft">
        <div className="mb-8 flex items-center gap-3 text-xl font-bold text-brand">
          <img src="/brand/matmakt-mark.svg" alt="" className="h-12 w-12" />
          <div>
            <p className="text-2xl font-black text-slate-950">Matmakt</p>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Sett passord</p>
          </div>
        </div>

        <h1 className="page-heading">Velg passord</h1>
        <p className="mt-2 text-sm text-muted">Skriv et passord du kan bruke neste gang. Magic link virker fortsatt hvis du heller vil bruke det.</p>

        <form onSubmit={savePassword} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Nytt passord
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Gjenta passord
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </label>

          {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}

          <button disabled={loading} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? "Lagrer..." : "Lagre passord"}
          </button>
          <Link href="/onboarding" className="block rounded-xl border border-line px-4 py-3 text-center text-sm font-semibold text-brand">
            Videre til Matmakt
          </Link>
        </form>
      </section>
    </main>
  );
}
