import { getSupabaseAdmin } from "@/lib/supabase-server";

type Household = {
  id: string;
  name: string;
};

/**
 * @deprecated Do not use in ordinary Matmakt flows.
 *
 * Households are user-owned/selected by id. This helper is kept only as a
 * temporary escape hatch for old one-off scripts. It is disabled by default so
 * new API routes do not silently create or use a global "Familien" household.
 */
export async function ensureDefaultHousehold(): Promise<Household> {
  if (process.env.ALLOW_LEGACY_DEFAULT_HOUSEHOLD !== "true") {
    throw new Error("Legacy default-husholdning er deaktivert. Bruk aktiv household_id i stedet.");
  }

  const supabase = getSupabaseAdmin();
  const name = process.env.DEFAULT_HOUSEHOLD_NAME ?? "Familien";

  // Do not use .single() / .maybeSingle() here. During setup it is easy to
  // create duplicate household rows, and PostgREST then returns PGRST116:
  // "JSON object requested, multiple rows returned". Use the oldest row and
  // let the cleanup SQL enforce uniqueness afterwards.
  const existing = await supabase
    .from("households")
    .select("id, name, created_at")
    .eq("name", name)
    .order("created_at", { ascending: true })
    .limit(1);

  if (existing.error) throw existing.error;
  if (existing.data?.[0]) {
    return { id: existing.data[0].id, name: existing.data[0].name };
  }

  const created = await supabase
    .from("households")
    .insert({ name, monthly_budget: 0 })
    .select("id, name")
    .limit(1);

  if (created.error) {
    // If another request created the same household at the same time, retry read.
    const retry = await supabase
      .from("households")
      .select("id, name, created_at")
      .eq("name", name)
      .order("created_at", { ascending: true })
      .limit(1);

    if (retry.error) throw retry.error;
    if (retry.data?.[0]) return { id: retry.data[0].id, name: retry.data[0].name };
    throw created.error;
  }

  if (!created.data?.[0]) {
    throw new Error("Kunne ikke opprette husholdning");
  }

  return created.data[0];
}
