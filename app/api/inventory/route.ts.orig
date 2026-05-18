import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { canonicalStoreName, normalizeStoreCode } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

type HouseholdProductRow = {
  product_id: string;
  desired_stock: number | null;
  is_basis: boolean | null;
};

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  preferred_store: string | null;
  target_price: number | null;
  desired_stock: number | null;
};

type InventoryRow = {
  id: string;
  household_id: string;
  product_id: string;
  location: string | null;
  quantity: number | null;
  desired_quantity: number | null;
  expires_at: string | null;
  updated_at: string | null;
};

type PriceObservationRow = {
  product_id: string;
  store_code: string | null;
  store_name: string | null;
  price: number | null;
  unit_price: number | null;
  observed_at: string | null;
};

type StorePreferenceRow = {
  store_key: string | null;
  store_name: string | null;
  is_enabled: boolean | null;
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

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function desiredFor(product: ProductRow | null, householdProduct: HouseholdProductRow | null) {
  return Math.max(0, Math.round(toNumber(householdProduct?.desired_stock, toNumber(product?.desired_stock, 1))));
}

function stockStatus(quantity: number, desiredQuantity: number) {
  if (quantity <= 0 && desiredQuantity > 0) return "Tomt";
  if (desiredQuantity > 0 && quantity < desiredQuantity) return "Lavt lager";
  if (desiredQuantity > 0 && quantity >= desiredQuantity * 1.8) return "Overfylt";
  return "På lager";
}

async function ensureInventoryRows(
  householdId: string,
  products: ProductRow[],
  householdProducts: HouseholdProductRow[],
  existingItems: InventoryRow[]
) {
  const existingProductIds = new Set(existingItems.map((item) => item.product_id));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const householdProductById = new Map(householdProducts.map((item) => [item.product_id, item]));

  const rowsToInsert = householdProducts
    .filter((item) => item.product_id && !existingProductIds.has(item.product_id))
    .map((item) => ({
      household_id: householdId,
      product_id: item.product_id,
      location: "Hjemme",
      quantity: 0,
      desired_quantity: desiredFor(productsById.get(item.product_id) ?? null, item),
      updated_at: new Date().toISOString()
    }));

  if (!rowsToInsert.length) return existingItems;

  const supabase = getSupabaseAdmin();
  const inserted = await supabase
    .from("inventory_items")
    .insert(rowsToInsert)
    .select("id, household_id, product_id, location, quantity, desired_quantity, expires_at, updated_at");

  if (inserted.error) throw inserted.error;
  return [...existingItems, ...((inserted.data ?? []) as InventoryRow[])];
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);

    const householdProductsResult = await supabase
      .from("household_products")
      .select("product_id, desired_stock, is_basis")
      .eq("household_id", householdId)
      .eq("is_basis", true);

    if (householdProductsResult.error) throw householdProductsResult.error;

    const householdProducts = (householdProductsResult.data ?? []) as HouseholdProductRow[];
    const productIds = [...new Set(householdProducts.map((item) => item.product_id).filter(Boolean))];

    if (!productIds.length) {
      return NextResponse.json({
        data: [],
        stats: { total: 0, low: 0, empty: 0, overstocked: 0, needsRestock: 0 }
      });
    }

    const [productsResult, inventoryResult, storePreferencesResult] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, brand, category, package_size, image_url, preferred_store, target_price, desired_stock")
        .in("id", productIds),
      supabase
        .from("inventory_items")
        .select("id, household_id, product_id, location, quantity, desired_quantity, expires_at, updated_at")
        .eq("household_id", householdId)
        .in("product_id", productIds),
      supabase
        .from("household_store_preferences")
        .select("store_key, store_name, is_enabled")
        .eq("household_id", householdId)
    ]);

    if (productsResult.error) throw productsResult.error;
    if (inventoryResult.error) throw inventoryResult.error;
    if (storePreferencesResult.error) throw storePreferencesResult.error;

    const products = (productsResult.data ?? []) as ProductRow[];
    const productsById = new Map(products.map((product) => [product.id, product]));
    const householdProductById = new Map(householdProducts.map((item) => [item.product_id, item]));
    const inventoryItems = await ensureInventoryRows(householdId, products, householdProducts, (inventoryResult.data ?? []) as InventoryRow[]);

    const activeStoreKeys = new Set(
      ((storePreferencesResult.data ?? []) as StorePreferenceRow[])
        .filter((store) => store.is_enabled !== false)
        .map((store) => normalizeStoreCode(store.store_key || store.store_name))
        .filter(Boolean)
    );

    const observationsResult = await supabase
      .from("price_observations")
      .select("product_id, store_code, store_name, price, unit_price, observed_at")
      .in("product_id", productIds)
      .order("observed_at", { ascending: false })
      .limit(10000);

    if (observationsResult.error) throw observationsResult.error;

    const latestPriceByProduct = new Map<
      string,
      { store_code: string | null; store_name: string | null; price: number | null; unit_price: number | null; observed_at: string | null; count: number }
    >();

    for (const observation of (observationsResult.data ?? []) as PriceObservationRow[]) {
      const storeCode = normalizeStoreCode(observation.store_code || observation.store_name);
      if (!storeCode) continue;
      if (activeStoreKeys.size && !activeStoreKeys.has(storeCode)) continue;

      const current = latestPriceByProduct.get(observation.product_id) ?? {
        store_code: null,
        store_name: null,
        price: null,
        unit_price: null,
        observed_at: null,
        count: 0
      };

      current.count += 1;
      if (!current.observed_at) {
        current.store_code = storeCode;
        current.store_name = canonicalStoreName(storeCode, observation.store_name || observation.store_code);
        current.price = observation.price;
        current.unit_price = observation.unit_price;
        current.observed_at = observation.observed_at;
      }

      latestPriceByProduct.set(observation.product_id, current);
    }

    const inventoryByProduct = new Map(inventoryItems.map((item) => [item.product_id, item]));

    const data = householdProducts
      .map((householdProduct) => {
        const product = productsById.get(householdProduct.product_id) ?? null;
        const inventory = inventoryByProduct.get(householdProduct.product_id) ?? null;
        if (!product || !inventory) return null;

        const quantity = toNumber(inventory.quantity);
        const desiredQuantity = toNumber(inventory.desired_quantity, desiredFor(product, householdProduct));
        const price = latestPriceByProduct.get(householdProduct.product_id) ?? {
          store_code: null,
          store_name: null,
          price: null,
          unit_price: null,
          observed_at: null,
          count: 0
        };

        return {
          ...inventory,
          quantity,
          desired_quantity: desiredQuantity,
          status: stockStatus(quantity, desiredQuantity),
          product,
          latest_price: price.price,
          latest_unit_price: price.unit_price,
          latest_store: price.store_name,
          latest_store_key: price.store_code,
          latest_observed_at: price.observed_at,
          price_observation_count: price.count
        };
      })
      .filter(Boolean);

    const stats = {
      total: data.length,
      low: data.filter((item) => item?.status === "Lavt lager").length,
      empty: data.filter((item) => item?.status === "Tomt").length,
      overstocked: data.filter((item) => item?.status === "Overfylt").length,
      needsRestock: data.filter((item) => item?.status === "Lavt lager" || item?.status === "Tomt").length
    };

    return NextResponse.json({ data, stats });
  } catch (error) {
    console.error("[api/inventory] GET", errorPayload(error, "Ukjent feil"));
    return apiErrorResponse(error);
  }
}
