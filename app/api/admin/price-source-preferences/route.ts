import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PriceSourcePreferences = {
  id?: string | null;
  household_id?: string | null;
  include_kassalapp: boolean | null;
  include_own_shelf_edge: boolean | null;
  include_other_shelf_edge: boolean | null;
  include_own_receipt: boolean | null;
  include_other_receipt: boolean | null;
  include_own_manual: boolean | null;
  include_other_manual: boolean | null;
  updated_at?: string | null;
};

type PreferenceKey = keyof Omit<PriceSourcePreferences, "id" | "household_id" | "updated_at">;

const DEFAULT_PREFERENCES: Record<PreferenceKey, boolean> = {
  include_kassalapp: true,
  include_own_shelf_edge: true,
  include_other_shelf_edge: true,
  include_own_receipt: true,
  include_other_receipt: false,
  include_own_manual: true,
  include_other_manual: false
};

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan gjøre dette"), { status: 403 });
  }
}

function normalizePreferences(row?: Partial<PriceSourcePreferences> | null): PriceSourcePreferences {
  return {
    id: row?.id ?? null,
    household_id: row?.household_id ?? null,
    include_kassalapp: row?.include_kassalapp ?? DEFAULT_PREFERENCES.include_kassalapp,
    include_own_shelf_edge: row?.include_own_shelf_edge ?? DEFAULT_PREFERENCES.include_own_shelf_edge,
    include_other_shelf_edge: row?.include_other_shelf_edge ?? DEFAULT_PREFERENCES.include_other_shelf_edge,
    include_own_receipt: row?.include_own_receipt ?? DEFAULT_PREFERENCES.include_own_receipt,
    include_other_receipt: row?.include_other_receipt ?? DEFAULT_PREFERENCES.include_other_receipt,
    include_own_manual: row?.include_own_manual ?? DEFAULT_PREFERENCES.include_own_manual,
    include_other_manual: row?.include_other_manual ?? DEFAULT_PREFERENCES.include_other_manual,
    updated_at: row?.updated_at ?? null
  };
}

function preferenceUpdates(body: Record<string, unknown>): Partial<Record<PreferenceKey, boolean>> {
  const updates: Partial<Record<PreferenceKey, boolean>> = {};

  for (const key of Object.keys(DEFAULT_PREFERENCES) as PreferenceKey[]) {
    if (key in body) {
      updates[key] = body[key] === true;
    }
  }

  return updates;
}

export async function GET(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("household_price_source_preferences")
      .select("id, household_id, include_kassalapp, include_own_shelf_edge, include_other_shelf_edge, include_own_receipt, include_other_receipt, include_own_manual, include_other_manual, updated_at")
      .eq("household_id", current.householdId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ data: normalizePreferences(data) });
  } catch (error) {
    console.error("[api/admin/price-source-preferences] GET", error);
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updates = preferenceUpdates(body);

    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "Ingen gyldige priskildevalg" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const payload = {
      household_id: current.householdId,
      ...updates,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("household_price_source_preferences")
      .upsert(payload, { onConflict: "household_id" })
      .select("id, household_id, include_kassalapp, include_own_shelf_edge, include_other_shelf_edge, include_own_receipt, include_other_receipt, include_own_manual, include_other_manual, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ data: normalizePreferences(data) });
  } catch (error) {
    console.error("[api/admin/price-source-preferences] PATCH", error);
    return apiErrorResponse(error);
  }
}
