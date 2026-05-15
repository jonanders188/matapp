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

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stockStatus(quantity: number, desiredQuantity: number) {
  if (quantity <= 0 && desiredQuantity > 0) return "Tomt";
  if (desiredQuantity > 0 && quantity < desiredQuantity) return "Lavt lager";
  if (desiredQuantity > 0 && quantity >= desiredQuantity * 1.8) return "Overfylt";
  return "På lager";
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);

    const inventoryResult = await supabase
      .from("inventory_items")
      .select("id, household_id, product_id, location, quantity, desired_quantity, expires_at, updated_at")
      .eq("household_id", householdId)
      .order("updated_at", { ascending: false });

    if (inventoryResult.error) throw inventoryResult.error;

    const inventoryItems = inventoryResult.data ?? [];
    const productIds = [...new Set(inventoryItems.map((item) => item.product_id).filter(Boolean))];

    const [productsResult, observationsResult] = await Promise.all([
      productIds.length
        ? supabase
            .from("products")
            .select("id, name, brand, category, package_size, image_url, preferred_store, target_price")
            .in("id", productIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length
        ? supabase
            .from("price_observations")
            .select("product_id, store_name, price, unit_price, observed_at")
            .in("product_id", productIds)
            .order("observed_at", { ascending: false })
        : Promise.resolve({ data: [], error: null })
    ]);

    if (productsResult.error) throw productsResult.error;
    if (observationsResult.error) throw observationsResult.error;

    const productsById = new Map((productsResult.data ?? []).map((product) => [product.id, product]));
    const latestPriceByProduct = new Map<string, { store_name: string | null; price: number | null; unit_price: number | null; observed_at: string | null; count: number }>();

    for (const observation of observationsResult.data ?? []) {
      const current = latestPriceByProduct.get(observation.product_id) ?? {
        store_name: null,
        price: null,
        unit_price: null,
        observed_at: null,
        count: 0
      };

      current.count += 1;
      if (!current.observed_at) {
        current.store_name = observation.store_name;
        current.price = observation.price;
        current.unit_price = observation.unit_price;
        current.observed_at = observation.observed_at;
      }

      latestPriceByProduct.set(observation.product_id, current);
    }

    const data = inventoryItems.map((item) => {
      const quantity = toNumber(item.quantity);
      const desiredQuantity = toNumber(item.desired_quantity);
      const product = productsById.get(item.product_id) ?? null;
      const price = latestPriceByProduct.get(item.product_id) ?? {
        store_name: null,
        price: null,
        unit_price: null,
        observed_at: null,
        count: 0
      };

      return {
        ...item,
        quantity,
        desired_quantity: desiredQuantity,
        status: stockStatus(quantity, desiredQuantity),
        product,
        latest_price: price.price,
        latest_unit_price: price.unit_price,
        latest_store: price.store_name,
        latest_observed_at: price.observed_at,
        price_observation_count: price.count
      };
    });

    const stats = {
      total: data.length,
      low: data.filter((item) => item.status === "Lavt lager").length,
      empty: data.filter((item) => item.status === "Tomt").length,
      overstocked: data.filter((item) => item.status === "Overfylt").length,
      needsRestock: data.filter((item) => item.status === "Lavt lager" || item.status === "Tomt").length
    };

    return NextResponse.json({ data, stats });
  } catch (error) {
    console.error("[api/inventory] GET", errorPayload(error, "Ukjent feil"));
    return apiErrorResponse(error);
  }
}
