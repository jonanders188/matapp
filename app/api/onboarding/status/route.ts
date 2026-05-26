import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    const supabase = getSupabaseAdmin();

    const [basisResult, inventoryResult] = await Promise.all([
      supabase
        .from("household_products")
        .select("id", { count: "exact", head: true })
        .eq("household_id", current.householdId)
        .eq("is_basis", true),
      supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("household_id", current.householdId)
    ]);

    if (basisResult.error) throw basisResult.error;
    if (inventoryResult.error) throw inventoryResult.error;

    return NextResponse.json({
      data: {
        household_id: current.householdId,
        role: current.role,
        basis_count: basisResult.count ?? 0,
        inventory_count: inventoryResult.count ?? 0,
        onboarding_complete: (basisResult.count ?? 0) > 0
      }
    });
  } catch (error) {
    console.error("[api/onboarding/status] GET", error);
    return apiErrorResponse(error);
  }
}
