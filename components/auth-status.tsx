"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type UserState = {
  email: string | null;
  loading: boolean;
};

export function AuthStatus() {
  const [state, setState] = useState<UserState>({ email: null, loading: true });

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data }) => {
      setState({ email: data.user?.email ?? null, loading: false });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ email: session?.user?.email ?? null, loading: false });
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (state.loading) {
    return <span className="rounded-full border border-line px-4 py-2 text-sm text-slate-500">Sjekker innlogging...</span>;
  }

  if (!state.email) {
    return (
      <Link href="/login" className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-brand">
        Logg inn
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="max-w-[220px] truncate rounded-full border border-line px-4 py-2 text-sm text-brand">{state.email}</span>
      <button onClick={signOut} className="rounded-full border border-line px-3 py-2 text-sm text-slate-600">
        Logg ut
      </button>
    </div>
  );
}
