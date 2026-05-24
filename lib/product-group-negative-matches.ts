import { getSupabaseAdmin } from "@/lib/supabase-server";

export type NegativeMatchInput = {
  productIdA: string;
  productIdB: string;
  reason?: string | null;
  source?: "system_admin_rejected" | "system_admin_removed_member" | "manual_cleanup";
  createdBy?: string | null;
};

export function orderedProductPair(productIdA: string, productIdB: string) {
  return productIdA < productIdB
    ? { product_id_a: productIdA, product_id_b: productIdB }
    : { product_id_a: productIdB, product_id_b: productIdA };
}

export function pairKey(productIdA: string, productIdB: string) {
  const pair = orderedProductPair(productIdA, productIdB);
  return `${pair.product_id_a}:${pair.product_id_b}`;
}

export async function createNegativeMatches(matches: NegativeMatchInput[]) {
  const rows = matches
    .filter((match) => match.productIdA && match.productIdB && match.productIdA !== match.productIdB)
    .map((match) => {
      const pair = orderedProductPair(match.productIdA, match.productIdB);
      return {
        ...pair,
        reason: match.reason ?? null,
        source: match.source ?? "system_admin_rejected",
        is_active: true,
        created_by: match.createdBy ?? null,
        updated_at: new Date().toISOString()
      };
    });

  if (!rows.length) return { count: 0 };

  const dedupedRows = [...new Map(rows.map((row) => [`${row.product_id_a}:${row.product_id_b}`, row])).values()];
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("product_group_negative_matches")
    .upsert(dedupedRows, { onConflict: "product_id_a,product_id_b" });

  if (error) throw error;
  return { count: dedupedRows.length };
}

export async function loadActiveNegativeMatchKeys(productIds: string[]) {
  const uniqueProductIds = [...new Set(productIds)].filter(Boolean);
  if (!uniqueProductIds.length) return new Set<string>();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("product_group_negative_matches")
    .select("product_id_a, product_id_b")
    .eq("is_active", true)
    .or(`product_id_a.in.(${uniqueProductIds.join(",")}),product_id_b.in.(${uniqueProductIds.join(",")})`);

  if (error) throw error;

  return new Set((data ?? []).map((row) => pairKey(String(row.product_id_a), String(row.product_id_b))));
}
