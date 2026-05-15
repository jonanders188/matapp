import { NextResponse } from "next/server";
import { normalizeCategory, packageSize, type KassalappProduct } from "@/lib/kassalapp";
import { insertPriceObservations } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as ApiErrorLike).message);
  }
  return fallback;
}

function errorPayload(error: unknown, fallback: string) {
  const err = error as ApiErrorLike | null;
  return {
    error: errorMessage(error, fallback),
    code: err?.code ?? null,
    details: err?.details ?? null,
    hint: err?.hint ?? null
  };
}

function logApiError(context: string, error: unknown) {
  console.error(`[api/products] ${context}`, errorPayload(error, "Ukjent feil"));
}

function productPayload(product: KassalappProduct, householdId: string) {
  return {
    household_id: householdId,
    kassalapp_id: product.id,
    ean: product.ean ?? null,
    name: product.name,
    brand: product.brand ?? null,
    category: normalizeCategory(product),
    package_size: packageSize(product),
    image_url: product.image ?? null,
    target_price: product.current_price ?? null,
    target_price_unit: product.current_unit_price ? "unit_price" : "unit",
    preferred_store: product.store?.name ?? null,
    desired_stock: 1,
    is_basis: true,
    notes: product.url ?? null
  };
}

async function ensureInventoryItem(householdId: string, productId: string, product: KassalappProduct) {
  const supabase = getSupabaseAdmin();
  const location = product.category?.some((category) => category.name.toLowerCase().includes("melk"))
    ? "Kjoleskap"
    : "Kjokken";

  const existing = await supabase
    .from("inventory_items")
    .select("id")
    .eq("household_id", householdId)
    .eq("product_id", productId)
    .eq("location", location)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (existing.error) {
    logApiError("inventory_items select feilet", existing.error);
    return errorMessage(existing.error, "Kunne ikke sjekke lagerlinje");
  }

  if (existing.data?.[0]) {
    const { error } = await supabase
      .from("inventory_items")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", existing.data[0].id);

    if (error) {
      logApiError("inventory_items update feilet", error);
      return errorMessage(error, "Kunne ikke oppdatere lagerlinje");
    }

    return null;
  }

  const { error } = await supabase.from("inventory_items").insert({
    household_id: householdId,
    product_id: productId,
    location,
    quantity: 0,
    desired_quantity: 1
  });

  if (error) {
    logApiError("inventory_items insert feilet", error);
    return errorMessage(error, "Kunne ikke opprette lagerlinje");
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);

    // Hold produktselecten enkel. Vi henter prisobservasjoner separat for å unngå
    // PostgREST-relasjonsfeil når Supabase schema-cache ikke er ferdig oppdatert.
    const { data, error } = await supabase
      .from("products")
      .select("id, name, brand, ean, category, package_size, image_url, target_price, preferred_store, desired_stock, is_basis, created_at")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const products = data ?? [];
    const productIds = products.map((product) => product.id);

    if (!productIds.length) {
      return NextResponse.json({ data: [] });
    }

    const observations = await supabase
      .from("price_observations")
      .select("product_id, store_name, price, unit_price, observed_at")
      .in("product_id", productIds)
      .order("observed_at", { ascending: false });

    if (observations.error) {
      logApiError("price_observations select feilet", observations.error);
    }

    const stats = new Map<
      string,
      {
        price_observation_count: number;
        latest_price: number | null;
        latest_unit_price: number | null;
        latest_store: string | null;
        latest_observed_at: string | null;
      }
    >();

    for (const observation of observations.data ?? []) {
      const current = stats.get(observation.product_id) ?? {
        price_observation_count: 0,
        latest_price: null,
        latest_unit_price: null,
        latest_store: null,
        latest_observed_at: null
      };

      current.price_observation_count += 1;

      if (!current.latest_observed_at) {
        current.latest_price = observation.price;
        current.latest_unit_price = observation.unit_price;
        current.latest_store = observation.store_name;
        current.latest_observed_at = observation.observed_at;
      }

      stats.set(observation.product_id, current);
    }

    return NextResponse.json({
      data: products.map((product) => ({
        ...product,
        ...(stats.get(product.id) ?? {
          price_observation_count: 0,
          latest_price: null,
          latest_unit_price: null,
          latest_store: null,
          latest_observed_at: null
        })
      }))
    });
  } catch (error) {
    logApiError("GET feilet", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { product?: KassalappProduct; priceProducts?: KassalappProduct[] };
    const product = body.product;
    const priceProducts = Array.isArray(body.priceProducts) ? body.priceProducts : [];

    if (!product?.id || !product.name) {
      return NextResponse.json({ error: "Mangler produkt" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);
    const payload = productPayload(product, householdId);

    const existingQuery = product.ean
      ? supabase
          .from("products")
          .select("id")
          .eq("household_id", householdId)
          .eq("ean", product.ean)
          .order("created_at", { ascending: true })
          .limit(1)
      : supabase
          .from("products")
          .select("id")
          .eq("household_id", householdId)
          .eq("kassalapp_id", product.id)
          .order("created_at", { ascending: true })
          .limit(1);

    const existing = await existingQuery;
    if (existing.error) throw existing.error;

    const existingProduct = existing.data?.[0];
    const result = existingProduct
      ? await supabase.from("products").update(payload).eq("id", existingProduct.id).select("*").single()
      : await supabase.from("products").insert(payload).select("*").single();

    if (result.error) throw result.error;

    const warnings: string[] = [];
    const inventoryWarning = await ensureInventoryItem(householdId, result.data.id, product);
    if (inventoryWarning) warnings.push(inventoryWarning);

    const priceResult = await insertPriceObservations(result.data.id, product, priceProducts, "kassalapp-save");
    if (priceResult.error) warnings.push(priceResult.error);

    return NextResponse.json({
      data: result.data,
      warnings,
      priceObservationsInserted: priceResult.inserted
    });
  } catch (error) {
    logApiError("POST feilet", error);
    return apiErrorResponse(error);
  }
}
