import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toBoolean(value: unknown) {
  return value === true || value === "true" || value === "on";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const isBasis = toBoolean(body?.is_basis);
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);

    const productResult = await supabase
      .from("products")
      .select("id, household_id, desired_stock, target_price, target_price_unit, preferred_store, is_freezable, notes")
      .eq("id", id)
      .limit(1);

    if (productResult.error) throw productResult.error;

    const product = productResult.data?.[0];
    if (!product) {
      return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });
    }

    const existing = await supabase
      .from("household_products")
      .select("id")
      .eq("household_id", householdId)
      .eq("product_id", id)
      .limit(1);

    if (existing.error) throw existing.error;

    const payload = {
      household_id: householdId,
      product_id: id,
      is_basis: isBasis,
      desired_stock: product.desired_stock ?? 1,
      target_price: product.target_price ?? null,
      target_price_unit: product.target_price_unit ?? "unit",
      preferred_store: product.preferred_store ?? null,
      is_freezable: product.is_freezable ?? false,
      notes: product.notes ?? null,
      updated_at: new Date().toISOString()
    };

    const result = existing.data?.[0]
      ? await supabase.from("household_products").update({ is_basis: isBasis, updated_at: payload.updated_at }).eq("id", existing.data[0].id).select("*").single()
      : await supabase.from("household_products").insert(payload).select("*").single();

    if (result.error) throw result.error;

    return NextResponse.json({ data: result.data });
  } catch (error) {
    console.error("[api/products/[id]/basis] PATCH feilet", error);
    return apiErrorResponse(error);
  }
}
