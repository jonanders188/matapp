import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

type ProductRow = Record<string, any> & {
  id: string;
  household_id: string | null;
  name: string;
  target_price?: number | null;
  target_price_unit?: string | null;
  desired_stock?: number | null;
  is_basis?: boolean | null;
  is_freezable?: boolean | null;
  preferred_store?: string | null;
  notes?: string | null;
};

type HouseholdProductRow = {
  id: string;
  household_id: string;
  product_id: string;
  is_basis: boolean | null;
  desired_stock: number | null;
  target_price: number | null;
  target_price_unit: string | null;
  preferred_store: string | null;
  is_freezable: boolean | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
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

function mergeHouseholdProduct(product: ProductRow, householdProduct?: HouseholdProductRow | null) {
  if (!householdProduct) return product;

  return {
    ...product,
    is_basis: householdProduct.is_basis ?? product.is_basis,
    desired_stock: householdProduct.desired_stock ?? product.desired_stock,
    target_price: householdProduct.target_price ?? product.target_price,
    target_price_unit: householdProduct.target_price_unit ?? product.target_price_unit,
    preferred_store: householdProduct.preferred_store ?? product.preferred_store,
    is_freezable: householdProduct.is_freezable ?? product.is_freezable,
    notes: householdProduct.notes ?? product.notes,
    household_product_id: householdProduct.id,
    household_product_updated_at: householdProduct.updated_at
  };
}

async function loadProductForHousehold(productId: string, householdId: string) {
  const supabase = getSupabaseAdmin();

  const productResult = await supabase.from("products").select("*").eq("id", productId).limit(1);
  if (productResult.error) throw productResult.error;

  const product = productResult.data?.[0] as ProductRow | undefined;
  if (!product) return { product: null as ProductRow | null, householdProduct: null as HouseholdProductRow | null };

  const householdProductResult = await supabase
    .from("household_products")
    .select("id, household_id, product_id, is_basis, desired_stock, target_price, target_price_unit, preferred_store, is_freezable, notes, created_at, updated_at")
    .eq("household_id", householdId)
    .eq("product_id", productId)
    .limit(1);

  if (householdProductResult.error) throw householdProductResult.error;

  const householdProduct = (householdProductResult.data?.[0] ?? null) as HouseholdProductRow | null;

  return { product, householdProduct };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);

    const { product, householdProduct } = await loadProductForHousehold(id, householdId);

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

    const lowestByStore = new Map<string, { store_name: string; price: number; unit_price: number | null; observed_at: string; source: string | null; source_url: string | null }>();
    for (const observation of priceResult.data ?? []) {
      const key = observation.store_code || observation.store_name;
      const existing = lowestByStore.get(key);
      if (!existing || Number(observation.price) < Number(existing.price)) {
        lowestByStore.set(key, {
          store_name: observation.store_name,
          price: observation.price,
          unit_price: observation.unit_price,
          observed_at: observation.observed_at,
          source: observation.source,
          source_url: observation.source_url
        });
      }
    }

    return NextResponse.json({
      data: {
        product: mergeHouseholdProduct(product, householdProduct),
        household_product: householdProduct,
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

    const { product, householdProduct } = await loadProductForHousehold(id, householdId);
    if (!product) {
      return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });
    }

    const productUpdatePayload = {
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

    if (!productUpdatePayload.name) {
      return NextResponse.json({ error: "Produktnavn mangler" }, { status: 400 });
    }

    const productUpdate = await supabase.from("products").update(productUpdatePayload).eq("id", id).select("*").single();
    if (productUpdate.error) throw productUpdate.error;

    const desiredQuantity = toNullableNumber(body.desired_stock) ?? 0;
    const isBasis = toBoolean(body.is_basis);
    const now = new Date().toISOString();
    const householdPayload = {
      household_id: householdId,
      product_id: id,
      is_basis: isBasis,
      desired_stock: desiredQuantity,
      target_price: toNullableNumber(body.target_price),
      target_price_unit: body.target_price_unit === "unit_price" ? "unit_price" : "unit",
      preferred_store: body.preferred_store ? String(body.preferred_store).trim() : null,
      is_freezable: toBoolean(body.is_freezable),
      notes: body.notes ? String(body.notes).trim() : null,
      updated_at: now
    };

    const householdUpdate = householdProduct
      ? await supabase.from("household_products").update(householdPayload).eq("id", householdProduct.id).select("*").single()
      : await supabase.from("household_products").insert(householdPayload).select("*").single();

    if (householdUpdate.error) throw householdUpdate.error;

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
        .update({ desired_quantity: desiredQuantity, updated_at: now })
        .eq("id", existingInventory.data[0].id);
      if (inventoryUpdate.error) throw inventoryUpdate.error;
    } else if (isBasis) {
      const inventoryInsert = await supabase.from("inventory_items").insert({
        household_id: householdId,
        product_id: id,
        location: toBoolean(body.is_freezable) ? "Fryser" : "Kjokken",
        quantity: 0,
        desired_quantity: desiredQuantity
      });
      if (inventoryInsert.error) throw inventoryInsert.error;
    }

    return NextResponse.json({ data: mergeHouseholdProduct(productUpdate.data as ProductRow, householdUpdate.data as HouseholdProductRow) });
  } catch (error) {
    console.error("[api/products/[id]] PATCH feilet", errorPayload(error, "Kunne ikke lagre produktregler"));
    return apiErrorResponse(error);
  }
}
