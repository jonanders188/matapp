import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  created_at: string | null;
};

type HouseholdProductRow = {
  product_id: string;
  is_basis: boolean | null;
  desired_stock: number | null;
  target_price: number | null;
  preferred_store: string | null;
  updated_at: string | null;
};

function sanitizeSearch(value: string) {
  return value.replace(/[%_,]/g, " ").trim();
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);
    const url = new URL(request.url);
    const query = sanitizeSearch(url.searchParams.get("q") ?? "");

    let productsQuery = supabase
      .from("products")
      .select("id, name, brand, ean, category, package_size, image_url, created_at")
      .order("name", { ascending: true })
      .limit(query ? 120 : 80);

    if (query) {
      const pattern = `%${query}%`;
      productsQuery = productsQuery.or(`name.ilike.${pattern},brand.ilike.${pattern},ean.ilike.${pattern},category.ilike.${pattern}`);
    }

    const productsResult = await productsQuery;
    if (productsResult.error) throw productsResult.error;

    const products = (productsResult.data ?? []) as ProductRow[];

    const productIds = products.map((product) => product.id);

    const [householdProductsResult, observationsResult] = await Promise.all([
      productIds.length
        ? supabase
            .from("household_products")
            .select("product_id, is_basis, desired_stock, target_price, preferred_store, updated_at")
            .eq("household_id", householdId)
            .in("product_id", productIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length
        ? supabase
            .from("price_observations")
            .select("product_id, store_name, price, unit_price, observed_at")
            .in("product_id", productIds)
            .order("observed_at", { ascending: false })
        : Promise.resolve({ data: [], error: null })
    ]);

    if (householdProductsResult.error) throw householdProductsResult.error;
    if (observationsResult.error) throw observationsResult.error;

    const householdByProductId = new Map((householdProductsResult.data ?? []).map((row) => [row.product_id, row as HouseholdProductRow]));
    const statsByProductId = new Map<string, { price_observation_count: number; latest_price: number | null; latest_store: string | null; latest_observed_at: string | null }>();

    for (const observation of observationsResult.data ?? []) {
      const current = statsByProductId.get(observation.product_id) ?? {
        price_observation_count: 0,
        latest_price: null,
        latest_store: null,
        latest_observed_at: null
      };

      current.price_observation_count += 1;
      if (!current.latest_observed_at) {
        current.latest_price = observation.price;
        current.latest_store = observation.store_name;
        current.latest_observed_at = observation.observed_at;
      }
      statsByProductId.set(observation.product_id, current);
    }

    return NextResponse.json({
      data: products.map((product) => {
        const householdProduct = householdByProductId.get(product.id) ?? null;
        return {
          ...product,
          is_in_household: Boolean(householdProduct),
          is_basis: householdProduct?.is_basis ?? false,
          desired_stock: householdProduct?.desired_stock ?? null,
          target_price: householdProduct?.target_price ?? null,
          preferred_store: householdProduct?.preferred_store ?? null,
          household_product_updated_at: householdProduct?.updated_at ?? null,
          ...(statsByProductId.get(product.id) ?? {
            price_observation_count: 0,
            latest_price: null,
            latest_store: null,
            latest_observed_at: null
          })
        };
      })
    });
  } catch (error) {
    console.error("[api/catalog] GET", error);
    return apiErrorResponse(error);
  }
}
