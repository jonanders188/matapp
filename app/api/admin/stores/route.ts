import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type StorePreference = {
  id?: string | null;
  household_id?: string;
  store_key: string;
  store_name: string;
  priority: number | null;
  is_enabled: boolean | null;
  updated_at?: string | null;
};

const STANDARD_STORES: StorePreference[] = [
  { store_key: "kiwi", store_name: "KIWI", priority: 100, is_enabled: true },
  { store_key: "rema_1000", store_name: "REMA 1000", priority: 100, is_enabled: true },
  { store_key: "meny_no", store_name: "Meny", priority: 100, is_enabled: true },
  { store_key: "coop_no", store_name: "Coop", priority: 100, is_enabled: true },
  { store_key: "oda_no", store_name: "Oda", priority: 100, is_enabled: true },
  { store_key: "spar_no", store_name: "SPAR", priority: 100, is_enabled: true },
  { store_key: "joker_no", store_name: "Joker", priority: 100, is_enabled: true },
  { store_key: "europris_no", store_name: "Europris", priority: 100, is_enabled: true },
  { store_key: "bunnpris", store_name: "Bunnpris", priority: 100, is_enabled: true },
  { store_key: "engrossnett_no", store_name: "Engrosnett", priority: 100, is_enabled: true }
];

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan gjøre dette"), { status: 403 });
  }
}

function normalizeStoreKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function toPriority(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(999, Math.round(parsed)));
}

function displayStoreName(storeKeyValue: string, fallback: unknown) {
  const key = normalizeStoreKey(storeKeyValue);
  const fallbackName = String(fallback ?? storeKeyValue).trim();

  if (key === "kiwi") return "KIWI";
  if (key === "rema_1000") return "REMA 1000";
  if (key === "meny_no") return "Meny";
  if (key === "coop_no") return "Coop";
  if (key === "oda_no") return "Oda";
  if (key === "spar_no") return "SPAR";
  if (key === "joker_no") return "Joker";
  if (key === "europris_no") return "Europris";
  if (key === "bunnpris") return "Bunnpris";
  if (key === "engrossnett_no") return "Engrosnett";

  return fallbackName || storeKeyValue;
}

async function loadStores(householdId: string) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("household_store_preferences")
    .select("id, household_id, store_key, store_name, priority, is_enabled, updated_at")
    .eq("household_id", householdId)
    .order("priority", { ascending: true })
    .order("store_name", { ascending: true });

  if (error) throw error;

  const stores = new Map<string, StorePreference>();

  for (const standard of STANDARD_STORES) {
    const key = normalizeStoreKey(standard.store_key);
    stores.set(key, {
      id: null,
      store_key: key,
      store_name: displayStoreName(key, standard.store_name),
      priority: toPriority(standard.priority),
      is_enabled: standard.is_enabled !== false,
      updated_at: null
    });
  }

  for (const pref of (data ?? []) as StorePreference[]) {
    const key = normalizeStoreKey(pref.store_key);
    if (!key) continue;

    stores.set(key, {
      id: pref.id ?? null,
      household_id: pref.household_id,
      store_key: key,
      store_name: displayStoreName(key, pref.store_name),
      priority: toPriority(pref.priority),
      is_enabled: pref.is_enabled !== false,
      updated_at: pref.updated_at ?? null
    });
  }

  return [...stores.values()].sort((a, b) => {
    const priorityDiff = toPriority(a.priority) - toPriority(b.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return a.store_name.localeCompare(b.store_name, "nb");
  });
}

export async function GET(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);

    console.log("[api/admin/stores] GET isolated read-only");

    return NextResponse.json({
      data: {
        stores: STANDARD_STORES.map((store) => ({
          id: null,
          store_key: normalizeStoreKey(store.store_key),
          store_name: store.store_name,
          priority: store.priority,
          is_enabled: store.is_enabled,
          updated_at: null
        }))
      }
    });
  } catch (error) {
    console.error("[api/admin/stores] GET isolated error", error);
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

    const storeKeyValue = normalizeStoreKey(body.store_key);
    const storeName = displayStoreName(storeKeyValue, body.store_name ?? storeKeyValue);

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

    const { data: existingRows, error: existingError } = await supabase
      .from("household_store_preferences")
      .select("id")
      .eq("household_id", current.householdId)
      .ilike("store_key", storeKeyValue);

    if (existingError) throw existingError;

    const existing = existingRows?.[0];

    const result = existing?.id
      ? await supabase
          .from("household_store_preferences")
          .update(update)
          .eq("id", existing.id)
          .select("id, household_id, store_key, store_name, priority, is_enabled, updated_at")
          .single()
      : await supabase
          .from("household_store_preferences")
          .insert(update)
          .select("id, household_id, store_key, store_name, priority, is_enabled, updated_at")
          .single();

    if (result.error) throw result.error;

    return NextResponse.json({ data: result.data });
  } catch (error) {
    console.error("[api/admin/stores] PATCH", error);
    return apiErrorResponse(error);
  }
}
