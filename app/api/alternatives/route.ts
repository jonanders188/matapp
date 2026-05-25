import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  target_price: number | null;
};

type AlternativeRow = {
  id: string;
  product_id: string;
  alternative_name: string;
  alternative_brand: string | null;
  alternative_ean: string | null;
  alternative_image_url: string | null;
  alternative_store_name: string | null;
  alternative_price: number | null;
  alternative_unit_price: number | null;
  confidence: number | null;
  estimated_saving: number | null;
  status: "candidate" | "testing" | "accepted" | "rejected";
  reason: string | null;
  created_at: string;
  updated_at: string | null;
};

export async function GET(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    const supabase = getSupabaseAdmin();

    const alternativesResult = await supabase
      .from("product_alternatives")
      .select("id, product_id, alternative_name, alternative_brand, alternative_ean, alternative_image_url, alternative_store_name, alternative_price, alternative_unit_price, confidence, estimated_saving, status, reason, created_at, updated_at")
      .eq("household_id", current.householdId)
      .order("status", { ascending: true })
      .order("estimated_saving", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (alternativesResult.error) throw alternativesResult.error;

    const alternatives = (alternativesResult.data ?? []) as AlternativeRow[];
    const productIds = [...new Set(alternatives.map((item) => item.product_id).filter(Boolean))];

    const productsResult = productIds.length
      ? await supabase
          .from("products")
          .select("id, name, brand, category, image_url, target_price")
          .in("id", productIds)
      : { data: [], error: null };

    if (productsResult.error) throw productsResult.error;

    const productById = new Map((productsResult.data ?? []).map((product: ProductRow) => [product.id, product]));

    return NextResponse.json({
      data: alternatives.map((alternative) => ({
        ...alternative,
        product: productById.get(alternative.product_id) ?? null
      }))
    });
  } catch (error) {
    console.error("[api/alternatives] GET feilet", error);
    return apiErrorResponse(error);
  }
}
