import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const { householdId } = await requireCurrentHousehold(request);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("household_store_preferences")
      .select("store_key, store_name, is_enabled, priority")
      .eq("household_id", householdId)
      .order("priority", { ascending: true })
      .order("store_name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      data: {
        stores: (data ?? [])
          .filter((store) => store.store_key && store.store_name)
          .map((store) => ({
            storeKey: store.store_key,
            storeName: store.store_name,
            isEnabled: Boolean(store.is_enabled),
            priority: Number(store.priority ?? 100)
          }))
      }
    });
  } catch (error) {
    console.error("[api/mobile/stores]", error);
    return apiErrorResponse(error);
  }
}
