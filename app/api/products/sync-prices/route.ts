import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-guard";
import { ensureDefaultHousehold } from "@/lib/db";
import { requireCurrentHousehold } from "@/lib/current-household";
import { lookupKassalappProductsWithPricesByEan, productMetadataPayload, searchKassalappProducts, type KassalappProduct } from "@/lib/kassalapp";
import { insertPriceObservations, priceProductsForProduct } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ProductRow = {
  id: string;
  name: string;
  ean: string | null;
  kassalapp_id: number | null;
};

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function errorPayload(error: unknown, fallback: string) {
  const err = error as ApiErrorLike | null;
  return {
    error: error instanceof Error ? error.message : err?.message ?? fallback,
    code: err?.code ?? null,
    details: err?.details ?? null,
    hint: err?.hint ?? null
  };
}

function sameProduct(product: ProductRow, candidate: KassalappProduct) {
  if (product.ean && candidate.ean) return product.ean === candidate.ean;
  if (product.kassalapp_id && candidate.id) return product.kassalapp_id === candidate.id;
  return candidate.name.toLowerCase().includes(product.name.toLowerCase().slice(0, 14));
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const supabase = getSupabaseAdmin();
    let householdId: string;
    try {
      householdId = (await requireCurrentHousehold(request)).householdId;
    } catch {
      const household = await ensureDefaultHousehold();
      householdId = household.id;
    }

    const productsResult = await supabase
      .from("products")
      .select("id, name, ean, kassalapp_id")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (productsResult.error) throw productsResult.error;

    const products = (productsResult.data ?? []) as ProductRow[];
    let searched = 0;
    let matchedProducts = 0;
    let inserted = 0;
    const warnings: string[] = [];

    for (const product of products) {
      const query = product.ean || product.name;
      if (!query) continue;

      try {
        searched += 1;
        const exactLookup = product.ean ? await lookupKassalappProductsWithPricesByEan(product.ean) : null;

        if (exactLookup?.selected) {
          const result = await insertPriceObservations(product.id, exactLookup.selected, exactLookup.related, "kassalapp-sync");
          if (result.error) throw new Error(result.error);
          const metadataUpdate = await supabase.from("products").update(productMetadataPayload(exactLookup.selected)).eq("id", product.id);
          if (metadataUpdate.error) throw metadataUpdate.error;
          inserted += result.inserted;
          if (result.inserted > 0) matchedProducts += 1;
          continue;
        }

        const matches = await searchKassalappProducts(query, 100);
        const relevant = matches.filter((candidate) => sameProduct(product, candidate));
        const candidates = relevant.length ? relevant : matches.slice(0, 20);
        const primary = candidates[0];

        if (primary) {
          const priceProducts = priceProductsForProduct(primary, candidates);
          const result = await insertPriceObservations(product.id, primary, priceProducts, "kassalapp-sync");
          if (result.error) throw new Error(result.error);
          const metadataUpdate = await supabase.from("products").update(productMetadataPayload(primary)).eq("id", product.id);
          if (metadataUpdate.error) throw metadataUpdate.error;
          inserted += result.inserted;
          if (result.inserted > 0) matchedProducts += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ukjent feil";
        warnings.push(`${product.name}: ${message}`);
      }
    }

    return NextResponse.json({ searched, matchedProducts, inserted, warnings });
  } catch (error) {
    console.error("[api/products/sync-prices] POST feilet", errorPayload(error, "Kunne ikke synke priser"));
    return NextResponse.json(errorPayload(error, "Kunne ikke synke priser"), { status: 500 });
  }
}
