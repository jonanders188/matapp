"use client";

import { createClient } from "@supabase/supabase-js";

let cachedClient: ReturnType<typeof createClient> | null = null;

function cleanSupabaseUrl(rawUrl: string) {
  return rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

export function getSupabaseBrowserClient() {
  if (cachedClient) return cachedClient;

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!rawUrl || !anonKey) {
    throw new Error("Supabase auth mangler NEXT_PUBLIC_SUPABASE_URL eller NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  cachedClient = createClient(cleanSupabaseUrl(rawUrl), anonKey);
  return cachedClient;
}
