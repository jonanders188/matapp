import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-guard";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { searchKassalappProducts } from "@/lib/kassalapp";

export async function GET(request: Request) {
  const unauthorized = await requireAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const supabase = getSupabaseAdmin();
    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, ean")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    let inserted = 0;
    for (const savedProduct of products ?? []) {
      const query = savedProduct.ean || savedProduct.name;
      const matches = await searchKassalappProducts(query, 8);
      const relevant = savedProduct.ean ? matches.filter((match) => match.ean === savedProduct.ean) : matches.slice(0, 3);

      for (const match of relevant) {
        if (!match.store || match.current_price == null) continue;
        const { error: insertError } = await supabase.from("price_observations").insert({
          product_id: savedProduct.id,
          store_code: match.store.code,
          store_name: match.store.name,
          price: match.current_price,
          unit_price: match.current_unit_price ?? null,
          observed_at: match.price_history?.[0]?.date ?? new Date().toISOString(),
          source: "kassalapp",
          source_url: match.url ?? null,
          raw: match
        });
        if (!insertError) inserted += 1;
      }
    }

    return NextResponse.json({ ok: true, products: products?.length ?? 0, inserted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Synk feilet" },
      { status: 500 }
    );
  }
}
