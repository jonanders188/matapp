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

    const storesByKey = new Map<string, {
      storeKey: string;
      storeName: string;
      isEnabled: boolean;
      priority: number;
    }>();

    for (const store of data ?? []) {
      const storeKey = String(store.store_key ?? "").trim().toLowerCase();
      const storeName = String(store.store_name ?? "").trim();
      if (!storeKey || !storeName) continue;

      const next = {
        storeKey,
        storeName,
        isEnabled: Boolean(store.is_enabled),
        priority: Number(store.priority ?? 100)
      };

      const existing = storesByKey.get(storeKey);
      if (!existing || next.priority < existing.priority || (next.isEnabled && !existing.isEnabled)) {
        storesByKey.set(storeKey, next);
      }
    }

    return NextResponse.json({
      data: {
        stores: [...storesByKey.values()].sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return a.storeName.localeCompare(b.storeName, "nb");
        })
      }
    });
  } catch (error) {
    console.error("[api/mobile/stores]", error);
    return apiErrorResponse(error);
  }
}
