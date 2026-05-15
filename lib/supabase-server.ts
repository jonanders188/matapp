import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedAdminClient: SupabaseClient | null = null;

function cleanSupabaseUrl(rawUrl: string) {
  return rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

export function getSupabaseAdmin() {
  if (cachedAdminClient) return cachedAdminClient;

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!rawUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL mangler");
  }

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY mangler");
  }

  const url = cleanSupabaseUrl(rawUrl);

  cachedAdminClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        "x-application-name": "husholdningspilot-mvp"
      }
    }
  });

  return cachedAdminClient;
}

export function getSupabaseConfigStatus() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    hasUrl: Boolean(rawUrl),
    hasServiceKey: Boolean(key),
    urlLooksValid: Boolean(rawUrl?.startsWith("https://") && rawUrl.includes(".supabase.co")),
    urlContainsRestPath: Boolean(rawUrl?.includes("/rest/v1"))
  };
}
