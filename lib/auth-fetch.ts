"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);

  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }

  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-cache");
  }

  return fetch(input, {
    ...init,
    cache: init.cache ?? "no-store",
    headers
  });
}
