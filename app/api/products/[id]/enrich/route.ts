import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { enrichProductWithOpenFoodFacts, type ProductEnrichmentRow } from "@/lib/product-enrichment";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { householdId } = await requireCurrentHousehold(request);
    const supabase = getSupabaseAdmin();

    const productResult = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .limit(1);

    if (productResult.error) throw productResult.error;
    const product = productResult.data?.[0] as ProductEnrichmentRow | undefined;

    if (!product) {
      return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });
    }

    const householdProductResult = await supabase
      .from("household_products")
      .select("id")
      .eq("household_id", householdId)
      .eq("product_id", id)
      .limit(1);

    if (householdProductResult.error) throw householdProductResult.error;

    if (!householdProductResult.data?.[0]) {
      return NextResponse.json({ error: "Produktet er ikke koblet til husholdningen" }, { status: 404 });
    }

    const result = await enrichProductWithOpenFoodFacts(supabase, product);

    if (!result.found) {
      return NextResponse.json({ found: false, message: result.message ?? "Fant ikke produktet i Open Food Facts" }, { status: 404 });
    }

    return NextResponse.json({
      found: true,
      source: "openfoodfacts",
      updatedFields: result.updatedFields,
      missingFields: result.missingFields,
      images: result.images,
      message: result.message
    });
  } catch (error) {
    console.error("[api/products/[id]/enrich] POST", error);
    return apiErrorResponse(error);
  }
}
