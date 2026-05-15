import { NextResponse } from "next/server";
import { normalizeCategory, packageSize, productMetadataPayload, type KassalappProduct } from "@/lib/kassalapp";
import { insertPriceObservations } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

type ProductRow = {
  id: string;
  household_id: string | null;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  target_price: number | null;
  preferred_store: string | null;
  desired_stock: number | null;
  is_basis: boolean | null;
  created_at: string | null;
  target_price_unit?: string | null;
  is_freezable?: boolean | null;
  notes?: string | null;
};

type HouseholdProductRow = {
  id?: string;
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
    notes: product.url ?? null,
    ...productMetadataPayload(product)
  };
}

function householdProductPayload(householdId: string, productId: string, product: KassalappProduct) {
  return {
    household_id: householdId,
    product_id: productId,
    is_basis: true,
    desired_stock: 1,
    target_price: product.current_price ?? null,
    target_price_unit: product.current_unit_price ? "unit_price" : "unit",
    preferred_store: product.store?.name ?? null,
    is_freezable: false,
    notes: product.url ?? null,
    updated_at: new Date().toISOString()
  };
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
    household_product_updated_at: householdProduct.updated_at
  };
}

async function ensureHouseholdProduct(householdId: string, productId: string, product: KassalappProduct) {
  const supabase = getSupabaseAdmin();
  const payload = householdProductPayload(householdId, productId, product);

  const existing = await supabase
    .from("household_products")
    .select("id")
    .eq("household_id", householdId)
    .eq("product_id", productId)
    .limit(1);

  if (existing.error) throw existing.error;

  const result = existing.data?.[0]
    ? await supabase.from("household_products").update(payload).eq("id", existing.data[0].id).select("*").single()
    : await supabase.from("household_products").insert(payload).select("*").single();

  if (result.error) throw result.error;
  return result.data;
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

async function attachPriceStats(products: ProductRow[]) {
  const supabase = getSupabaseAdmin();
  const productIds = products.map((product) => product.id);

  if (!productIds.length) return products.map((product) => ({
    ...product,
    price_observation_count: 0,
    latest_price: null,
    latest_unit_price: null,
    latest_store: null,
    latest_observed_at: null
  }));

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

  return products.map((product) => ({
    ...product,
    ...(stats.get(product.id) ?? {
      price_observation_count: 0,
      latest_price: null,
      latest_unit_price: null,
      latest_store: null,
      latest_observed_at: null
    })
  }));
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);
    const url = new URL(request.url);
    const basisOnly = url.searchParams.get("basis") === "true";

    const householdProductsResult = await supabase
      .from("household_products")
      .select("product_id, is_basis, desired_stock, target_price, target_price_unit, preferred_store, is_freezable, notes, created_at, updated_at")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false });

    if (householdProductsResult.error) throw householdProductsResult.error;

    const householdProducts = (householdProductsResult.data ?? []) as HouseholdProductRow[];
    const filteredHouseholdProducts = basisOnly ? householdProducts.filter((row) => row.is_basis === true) : householdProducts;
    const householdByProductId = new Map(householdProducts.map((row) => [row.product_id, row]));
    const productIds = filteredHouseholdProducts.map((row) => row.product_id).filter(Boolean);

    let products: ProductRow[] = [];

    if (productIds.length) {
      const productsResult = await supabase
        .from("products")
        .select("id, household_id, name, brand, ean, category, package_size, image_url, target_price, target_price_unit, preferred_store, desired_stock, is_basis, is_freezable, notes, created_at")
        .in("id", productIds);

      if (productsResult.error) throw productsResult.error;

      const productsById = new Map((productsResult.data ?? []).map((product) => [product.id, product as ProductRow]));
      products = productIds
        .map((productId) => {
          const product = productsById.get(productId);
          if (!product) return null;
          return mergeHouseholdProduct(product, householdByProductId.get(productId));
        })
        .filter(Boolean) as ProductRow[];
    }

    // Fallback while old rows are still being migrated into household_products.
    if (!products.length) {
      const fallbackQuery = supabase
        .from("products")
        .select("id, household_id, name, brand, ean, category, package_size, image_url, target_price, target_price_unit, preferred_store, desired_stock, is_basis, is_freezable, notes, created_at")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false });

      const fallback = basisOnly ? await fallbackQuery.eq("is_basis", true) : await fallbackQuery;
      if (fallback.error) throw fallback.error;
      products = (fallback.data ?? []) as ProductRow[];
    }

    return NextResponse.json({ data: await attachPriceStats(products) });
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

    let existingRows: Array<{ id: string; household_id: string | null; created_at: string | null }> = [];

    if (product.ean) {
      const existing = await supabase
        .from("products")
        .select("id, household_id, created_at")
        .eq("ean", product.ean)
        .order("created_at", { ascending: true })
        .limit(10);

      if (existing.error) throw existing.error;
      existingRows = existing.data ?? [];
    } else {
      const existing = await supabase
        .from("products")
        .select("id, household_id, created_at")
        .eq("kassalapp_id", product.id)
        .order("created_at", { ascending: true })
        .limit(10);

      if (existing.error) throw existing.error;
      existingRows = existing.data ?? [];
    }

    const existingProduct = existingRows.find((row) => row.household_id === householdId) ?? existingRows[0];
    const result = existingProduct
      ? await supabase.from("products").update({ ...payload, household_id: existingProduct.household_id ?? payload.household_id }).eq("id", existingProduct.id).select("*").single()
      : await supabase.from("products").insert(payload).select("*").single();

    if (result.error) throw result.error;

    const warnings: string[] = [];
    await ensureHouseholdProduct(householdId, result.data.id, product);

    const legacy = await supabase.from("products").update({ is_basis: true }).eq("id", result.data.id).eq("household_id", householdId);
    if (legacy.error) warnings.push(errorMessage(legacy.error, "Kunne ikke oppdatere legacy basisstatus"));

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
