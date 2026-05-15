import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function errorPayload(error: unknown, fallback: string) {
  const err = error as ApiErrorLike | null;
  return {
    error: error instanceof Error ? error.message : err?.message ?? fallback,
    code: err?.code ?? null,
    details: err?.details ?? null,
    hint: err?.hint ?? null
  };
}

function toNullableNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown) {
  return value === true || value === "true" || value === "on";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(_request);

    const productResult = await supabase
      .from("products")
      .select("*")
      .eq("household_id", householdId)
      .eq("id", id)
      .limit(1);

    if (productResult.error) throw productResult.error;
    const product = productResult.data?.[0];

    if (!product) {
      return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });
    }

    const inventoryResult = await supabase
      .from("inventory_items")
      .select("id, location, quantity, desired_quantity, expires_at, updated_at")
      .eq("household_id", householdId)
      .eq("product_id", id)
      .order("updated_at", { ascending: false });

    if (inventoryResult.error) throw inventoryResult.error;

    const priceResult = await supabase
      .from("price_observations")
      .select("id, store_code, store_name, price, unit_price, observed_at, source, source_url")
      .eq("product_id", id)
      .order("observed_at", { ascending: false })
      .limit(80);

    if (priceResult.error) throw priceResult.error;

    const lowestByStore = new Map<string, { store_name: string; price: number; unit_price: number | null; observed_at: string }>();
    for (const observation of priceResult.data ?? []) {
      const key = observation.store_name || observation.store_code;
      const existing = lowestByStore.get(key);
      if (!existing || Number(observation.price) < Number(existing.price)) {
        lowestByStore.set(key, {
          store_name: observation.store_name,
          price: observation.price,
          unit_price: observation.unit_price,
          observed_at: observation.observed_at
        });
      }
    }

    return NextResponse.json({
      data: {
        product,
        inventory: inventoryResult.data ?? [],
        price_observations: priceResult.data ?? [],
        lowest_by_store: Array.from(lowestByStore.values()).sort((a, b) => Number(a.price) - Number(b.price))
      }
    });
  } catch (error) {
    console.error("[api/products/[id]] GET feilet", errorPayload(error, "Kunne ikke hente produkt"));
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);

    const updatePayload = {
      name: String(body.name ?? "").trim(),
      brand: body.brand ? String(body.brand).trim() : null,
      category: body.category ? String(body.category).trim() : null,
      package_size: body.package_size ? String(body.package_size).trim() : null,
      target_price: toNullableNumber(body.target_price),
      target_price_unit: body.target_price_unit === "unit_price" ? "unit_price" : "unit",
      desired_stock: toNullableNumber(body.desired_stock) ?? 0,
      is_basis: toBoolean(body.is_basis),
      is_freezable: toBoolean(body.is_freezable),
      preferred_store: body.preferred_store ? String(body.preferred_store).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null
    };

    if (!updatePayload.name) {
      return NextResponse.json({ error: "Produktnavn mangler" }, { status: 400 });
    }

    const result = await supabase
      .from("products")
      .update(updatePayload)
      .eq("household_id", householdId)
      .eq("id", id)
      .select("*")
      .limit(1);

    if (result.error) throw result.error;
    if (!result.data?.[0]) {
      return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });
    }

    const desiredQuantity = toNullableNumber(body.desired_stock) ?? 0;
    const existingInventory = await supabase
      .from("inventory_items")
      .select("id")
      .eq("household_id", householdId)
      .eq("product_id", id)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (existingInventory.error) throw existingInventory.error;

    if (existingInventory.data?.[0]) {
      const inventoryUpdate = await supabase
        .from("inventory_items")
        .update({ desired_quantity: desiredQuantity, updated_at: new Date().toISOString() })
        .eq("id", existingInventory.data[0].id);
      if (inventoryUpdate.error) throw inventoryUpdate.error;
    } else {
      const inventoryInsert = await supabase.from("inventory_items").insert({
        household_id: householdId,
        product_id: id,
        location: body.is_freezable ? "Fryser" : "Kjokken",
        quantity: 0,
        desired_quantity: desiredQuantity
      });
      if (inventoryInsert.error) throw inventoryInsert.error;
    }

    return NextResponse.json({ data: result.data[0] });
  } catch (error) {
    console.error("[api/products/[id]] PATCH feilet", errorPayload(error, "Kunne ikke lagre produktregler"));
    return apiErrorResponse(error);
  }
}
