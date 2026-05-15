import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-guard";
import { ensureDefaultHousehold } from "@/lib/db";
import { requireCurrentHousehold } from "@/lib/current-household";
import { lookupKassalappProductsWithPricesByEan, searchKassalappProducts, type KassalappProduct } from "@/lib/kassalapp";
import { insertPriceObservations, priceProductsForProduct } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ApiErrorLike = { message?: string; code?: string; details?: string; hint?: string };

function errorPayload(error: unknown, fallback: string) {
  const err = error as ApiErrorLike | null;
  return {
    error: error instanceof Error ? error.message : err?.message ?? fallback,
    code: err?.code ?? null,
    details: err?.details ?? null,
    hint: err?.hint ?? null
  };
}

function sameProduct(product: { ean: string | null; kassalapp_id: number | null; name: string }, candidate: KassalappProduct) {
  if (product.ean && candidate.ean) return product.ean === candidate.ean;
  if (product.kassalapp_id && candidate.id) return product.kassalapp_id === candidate.id;
  return candidate.name.toLowerCase().includes(product.name.toLowerCase().slice(0, 14));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    let householdId: string;
    try {
      householdId = (await requireCurrentHousehold(request)).householdId;
    } catch {
      const household = await ensureDefaultHousehold();
      householdId = household.id;
    }

    const productResult = await supabase
      .from("products")
      .select("id, household_id, name, ean, kassalapp_id")
      .eq("household_id", householdId)
      .eq("id", id)
      .limit(1);

    if (productResult.error) throw productResult.error;
    const product = productResult.data?.[0];
    if (!product) return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });

    const exactLookup = product.ean ? await lookupKassalappProductsWithPricesByEan(product.ean) : null;

    if (exactLookup?.selected) {
      const result = await insertPriceObservations(product.id, exactLookup.selected, exactLookup.related, "kassalapp-product-sync");
      if (result.error) throw new Error(result.error);

      return NextResponse.json({
        searched: exactLookup.related.length,
        matched: exactLookup.related.length,
        inserted: result.inserted,
        lookup: "ean"
      });
    }

    const searchTerm = product.ean || product.name;
    const candidates = await searchKassalappProducts(searchTerm, 100);
    const matches = candidates.filter((candidate) => sameProduct(product, candidate));
    const fallback = candidates.slice(0, 20);
    const selected = matches.length ? matches : fallback;

    let inserted = 0;
    const primary = selected[0];
    if (primary) {
      const priceProducts = priceProductsForProduct(primary, selected);
      const result = await insertPriceObservations(product.id, primary, priceProducts, "kassalapp-product-sync");
      if (result.error) throw new Error(result.error);
      inserted = result.inserted;
    }

    return NextResponse.json({ searched: candidates.length, matched: matches.length, inserted, lookup: "search" });
  } catch (error) {
    console.error("[api/products/[id]/sync] POST feilet", errorPayload(error, "Kunne ikke synke produkt"));
    return NextResponse.json(errorPayload(error, "Kunne ikke synke produkt"), { status: 500 });
  }
}
