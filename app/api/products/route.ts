import { NextResponse } from "next/server";
import { normalizeCategory, packageSize, productMetadataPayload, type KassalappProduct } from "@/lib/kassalapp";
import { insertPriceObservations } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { normalizeProductEan } from "@/lib/product-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function productPayload(product: KassalappProduct) {
  return {
    kassalapp_id: product.id,
    ean: normalizeProductEan(product.ean),
    name: product.name,
    brand: product.brand ?? null,
    category: normalizeCategory(product),
    package_size: packageSize(product),
    image_url: product.image ?? null,
    notes: product.url ?? null,
    ...productMetadataPayload(product)
  };
}

type HouseholdProductRow = {
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

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  created_at: string | null;
  notes?: string | null;
};

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
  return {
    ...product,
    is_basis: householdProduct?.is_basis ?? false,
    desired_stock: householdProduct?.desired_stock ?? 0,
    target_price: householdProduct?.target_price ?? null,
    target_price_unit: householdProduct?.target_price_unit ?? "unit",
    preferred_store: householdProduct?.preferred_store ?? null,
    is_freezable: householdProduct?.is_freezable ?? false,
    notes: householdProduct?.notes ?? product.notes ?? null,
    household_product_updated_at: householdProduct?.updated_at ?? null
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

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);
    const url = new URL(request.url);
    const basisOnly = url.searchParams.get("basis") === "true";

    const householdProductsQuery = supabase
      .from("household_products")
      .select("product_id, is_basis, desired_stock, target_price, target_price_unit, preferred_store, is_freezable, notes, created_at, updated_at")
      .eq("household_id", householdId);

    const householdProductsResult = await (basisOnly
      ? householdProductsQuery.eq("is_basis", true)
      : householdProductsQuery
    ).order("created_at", { ascending: false });

    if (householdProductsResult.error) throw householdProductsResult.error;

    const householdProducts = (householdProductsResult.data ?? []) as HouseholdProductRow[];
    const householdByProductId = new Map(householdProducts.map((row) => [row.product_id, row]));
    const householdProductIds = householdProducts.map((row) => row.product_id).filter(Boolean);

    let products: ProductRow[] = [];

    if (householdProductIds.length) {
      const productsResult = await supabase
        .from("products")
        .select("id, name, brand, ean, category, package_size, image_url, notes, created_at")
        .in("id", householdProductIds);

      if (productsResult.error) throw productsResult.error;

      const productsById = new Map((productsResult.data ?? []).map((product) => [product.id, product as ProductRow]));
      products = householdProductIds
        .map((productId) => {
          const product = productsById.get(productId);
          if (!product) return null;
          return mergeHouseholdProduct(product, householdByProductId.get(productId));
        })
        .filter(Boolean) as ProductRow[];
    }


    const productIds = products.map((product) => product.id);

    if (!productIds.length) {
      return NextResponse.json({ data: [] });
    }

    type PriceObservationSummaryRow = {
      product_id: string;
      store_name: string | null;
      price: number | null;
      unit_price: number | null;
      observed_at: string | null;
    };

    const observationsData: PriceObservationSummaryRow[] = [];
    const pageSize = 1000;

    // Supabase/PostgREST caps result sets. Basisutvalg can easily have more
    // than 1000 price rows across all products, so a single query may miss
    // products and make them look like they have 0 observations. Read pages
    // until exhausted so /products uses the same product_id price history as
    // the product detail page.
    for (let from = 0; ; from += pageSize) {
      const page = await supabase
        .from("price_observations")
        .select("product_id, store_name, price, unit_price, observed_at")
        .in("product_id", productIds)
        .order("observed_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (page.error) {
        logApiError("price_observations select feilet", page.error);
        break;
      }

      const rows = (page.data ?? []) as PriceObservationSummaryRow[];
      observationsData.push(...rows);

      if (rows.length < pageSize) break;
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

    for (const observation of observationsData) {
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
    const payload = productPayload(product);
    const normalizedEan = normalizeProductEan(product.ean);

    let existingRows: Array<{ id: string; created_at: string | null }> = [];

    if (normalizedEan) {
      const existing = await supabase
        .from("products")
        .select("id, created_at")
        .eq("ean", normalizedEan)
        .order("created_at", { ascending: true })
        .limit(10);

      if (existing.error) throw existing.error;
      existingRows = existing.data ?? [];
    }

    if (!existingRows.length) {
      const existing = await supabase
        .from("products")
        .select("id, created_at")
        .eq("kassalapp_id", product.id)
        .order("created_at", { ascending: true })
        .limit(10);

      if (existing.error) throw existing.error;
      existingRows = existing.data ?? [];
    }

    const existingProduct = existingRows[0];

    let result = existingProduct
      ? await supabase.from("products").update(payload).eq("id", existingProduct.id).select("*").single()
      : await supabase.from("products").insert(payload).select("*").single();

    if (result.error && normalizedEan && (result.error as ApiErrorLike).code === "23505") {
      const existingAfterConflict = await supabase
        .from("products")
        .select("*")
        .eq("ean", normalizedEan)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (existingAfterConflict.error) throw existingAfterConflict.error;
      result = existingAfterConflict;
    }

    if (result.error) throw result.error;

    const householdProduct = await ensureHouseholdProduct(householdId, result.data.id, product);

    const warnings: string[] = [];
    const inventoryWarning = await ensureInventoryItem(householdId, result.data.id, product);
    if (inventoryWarning) warnings.push(inventoryWarning);

    const priceResult = await insertPriceObservations(result.data.id, product, priceProducts, "kassalapp-save");
    if (priceResult.error) warnings.push(priceResult.error);

    return NextResponse.json({
      data: {
        ...result.data,
        ...mergeHouseholdProduct(result.data, householdProduct)
      },
      household_product: householdProduct,
      warnings,
      priceObservationsInserted: priceResult.inserted
    });
  } catch (error) {
    logApiError("POST feilet", error);
    return apiErrorResponse(error);
  }
}
