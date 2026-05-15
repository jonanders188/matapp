import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type StorePreference = {
  id?: string;
  household_id?: string;
  store_key: string;
  store_name: string;
  priority: number | null;
  is_enabled: boolean | null;
  updated_at?: string | null;
};

type PriceStoreRow = {
  store_code: string | null;
  store_name: string;
};

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan gjøre dette"), { status: 403 });
  }
}

function storeKey(row: Pick<PriceStoreRow, "store_code" | "store_name">) {
  return String(row.store_code || row.store_name).trim();
}

function toPriority(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(999, Math.round(parsed)));
}

async function loadStores(householdId: string) {
  const supabase = getSupabaseAdmin();

  const { data: productsData, error: productsError } = await supabase
    .from("products")
    .select("id")
    .eq("household_id", householdId)
    .eq("is_basis", true);

  if (productsError) throw productsError;

  const productIds = (productsData ?? []).map((product) => product.id).filter(Boolean);

  const observedStores = new Map<string, PriceStoreRow>();

  if (productIds.length) {
    const { data: observationsData, error: observationsError } = await supabase
      .from("price_observations")
      .select("store_code, store_name")
      .in("product_id", productIds)
      .order("store_name", { ascending: true })
      .limit(5000);

    if (observationsError) throw observationsError;

    for (const row of (observationsData ?? []) as PriceStoreRow[]) {
      const key = storeKey(row);
      if (!key) continue;
      if (!observedStores.has(key)) observedStores.set(key, row);
    }
  }

  const { data: preferencesData, error: preferencesError } = await supabase
    .from("household_store_preferences")
    .select("id, household_id, store_key, store_name, priority, is_enabled, updated_at")
    .eq("household_id", householdId)
    .order("priority", { ascending: true })
    .order("store_name", { ascending: true });

  if (preferencesError) throw preferencesError;

  const preferences = new Map<string, StorePreference>();
  for (const pref of (preferencesData ?? []) as StorePreference[]) {
    preferences.set(pref.store_key, pref);
  }

  const discoveredWithoutPreference: StorePreference[] = [];
  for (const row of observedStores.values()) {
    const key = storeKey(row);
    if (!preferences.has(key)) {
      discoveredWithoutPreference.push({
        household_id: householdId,
        store_key: key,
        store_name: row.store_name,
        priority: 100,
        is_enabled: true
      });
    }
  }

  if (discoveredWithoutPreference.length) {
    const { error: upsertError } = await supabase
      .from("household_store_preferences")
      .upsert(discoveredWithoutPreference, { onConflict: "household_id,store_key" });

    if (upsertError) throw upsertError;

    const { data: refreshedData, error: refreshedError } = await supabase
      .from("household_store_preferences")
      .select("id, household_id, store_key, store_name, priority, is_enabled, updated_at")
      .eq("household_id", householdId)
      .order("priority", { ascending: true })
      .order("store_name", { ascending: true });

    if (refreshedError) throw refreshedError;
    return refreshedData ?? [];
  }

  return preferencesData ?? [];
}

export async function GET(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const stores = await loadStores(current.householdId);

    return NextResponse.json({ data: { stores } });
  } catch (error) {
    console.error("[api/admin/stores] GET", error);
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const body = (await request.json()) as {
      store_key?: unknown;
      store_name?: unknown;
      priority?: unknown;
      is_enabled?: unknown;
    };

    const storeKeyValue = String(body.store_key ?? "").trim();
    const storeName = String(body.store_name ?? storeKeyValue).trim();

    if (!storeKeyValue) {
      return NextResponse.json({ error: "Butikk mangler" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const update = {
      household_id: current.householdId,
      store_key: storeKeyValue,
      store_name: storeName || storeKeyValue,
      priority: toPriority(body.priority),
      is_enabled: body.is_enabled !== false,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("household_store_preferences")
      .upsert(update, { onConflict: "household_id,store_key" })
      .select("id, household_id, store_key, store_name, priority, is_enabled, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error) {
    console.error("[api/admin/stores] PATCH", error);
    return apiErrorResponse(error);
  }
}
