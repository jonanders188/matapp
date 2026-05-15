import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import {
  enrichProductWithOpenFoodFacts,
  shouldEnrichWithOpenFoodFacts,
  type ProductEnrichmentRow
} from "@/lib/product-enrichment";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type HouseholdProductRow = {
  product_id: string;
};

function clampLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(25, Math.round(parsed)));
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireCurrentHousehold(request);
    const body = await request.json().catch(() => ({}));
    const limit = clampLimit((body as { limit?: unknown })?.limit);
    const supabase = getSupabaseAdmin();

    const householdProductsResult = await supabase
      .from("household_products")
      .select("product_id")
      .eq("household_id", householdId)
      .eq("is_basis", true)
      .limit(500);

    if (householdProductsResult.error) throw householdProductsResult.error;

    const productIds = ((householdProductsResult.data ?? []) as HouseholdProductRow[])
      .map((row) => row.product_id)
      .filter(Boolean);

    if (!productIds.length) {
      return NextResponse.json({
        considered: 0,
        attempted: 0,
        found: 0,
        updated: 0,
        skippedNoEan: 0,
        skippedAlreadyComplete: 0,
        notFound: 0,
        errors: [],
        products: []
      });
    }

    const productsResult = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (productsResult.error) throw productsResult.error;

    const products = (productsResult.data ?? []) as ProductEnrichmentRow[];
    const skippedNoEan = products.filter((product) => !String(product.ean ?? "").replace(/\D/g, "")).length;
    const candidates = products.filter(shouldEnrichWithOpenFoodFacts).slice(0, limit);
    const skippedAlreadyComplete = products.length - skippedNoEan - products.filter(shouldEnrichWithOpenFoodFacts).length;

    let found = 0;
    let updated = 0;
    let notFound = 0;
    const errors: Array<{ productId: string; name: string; error: string }> = [];
    const productResults: Array<{
      productId: string;
      name: string;
      ean: string;
      found: boolean;
      updatedFields: string[];
      missingFields: string[];
    }> = [];

    for (const product of candidates) {
      try {
        const result = await enrichProductWithOpenFoodFacts(supabase, product);
        if (result.found) found += 1;
        if (!result.found) notFound += 1;
        if (result.updatedFields.length > 0) updated += 1;

        productResults.push({
          productId: product.id,
          name: product.name,
          ean: result.ean,
          found: result.found,
          updatedFields: result.updatedFields,
          missingFields: result.missingFields
        });
      } catch (error) {
        errors.push({
          productId: product.id,
          name: product.name,
          error: error instanceof Error ? error.message : "Ukjent feil"
        });
      }
    }

    return NextResponse.json({
      considered: products.length,
      attempted: candidates.length,
      found,
      updated,
      skippedNoEan,
      skippedAlreadyComplete,
      notFound,
      errors,
      products: productResults
    });
  } catch (error) {
    console.error("[api/products/enrich-basis] POST", error);
    return apiErrorResponse(error);
  }
}
