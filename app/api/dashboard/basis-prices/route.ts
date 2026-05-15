import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  package_size: string | null;
  target_price: number | null;
  desired_stock: number | null;
  preferred_store: string | null;
  image_url: string | null;
};

type HouseholdProductRow = {
  product_id: string;
  desired_stock: number | null;
  target_price: number | null;
  preferred_store: string | null;
};

type InventoryRow = {
  product_id: string | null;
  quantity: number | null;
  desired_quantity: number | null;
};

type PriceObservationRow = {
  product_id: string;
  store_code: string | null;
  store_name: string;
  price: number;
  unit_price: number | null;
  observed_at: string;
};

type ProductComparison = {
  productId: string;
  name: string;
  subtitle: string;
  desiredQuantity: number;
  currentQuantity: number;
  targetPrice: number | null;
  lowestStore: string | null;
  lowestStoreKey: string | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  saving: number | null;
  storePrices: Record<string, number>;
  freshStorePrices: Record<string, number>;
  storePriceAgeDays: Record<string, number>;
  storePriceFreshness: Record<string, PriceFreshness>;
  imageUrl: string | null;
};

type StorePreferenceRow = {
  store_key: string;
  store_name: string;
  priority: number | null;
  is_enabled: boolean | null;
};

type StoreComparison = {
  store: string;
  storeKey: string;
  priority: number;
  isEnabled: boolean;
  total: number;
  matchedProducts: number;
  productCount: number;
  coveragePct: number;
  missingProducts: number;
};

const PRICE_FRESH_DAYS = 14;
const PRICE_FALLBACK_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type PriceFreshness = "fresh" | "fallback";

function priceAgeDays(observedAt: string, now = new Date()) {
  const observedTime = new Date(observedAt).getTime();
  if (!Number.isFinite(observedTime)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - observedTime) / MS_PER_DAY));
}

function priceFreshness(observedAt: string, now = new Date()): PriceFreshness | null {
  const ageDays = priceAgeDays(observedAt, now);
  if (ageDays <= PRICE_FRESH_DAYS) return "fresh";
  if (ageDays <= PRICE_FALLBACK_DAYS) return "fallback";
  return null;
}

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function storeKey(observation: Pick<PriceObservationRow, "store_code" | "store_name">) {
  return String(observation.store_code || observation.store_name).trim().toLowerCase();
}

function observationKey(observation: PriceObservationRow) {
  return `${observation.product_id}:${storeKey(observation)}`;
}

async function loadLegacyBasisProducts(supabase: ReturnType<typeof getSupabaseAdmin>, householdId: string) {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, brand, package_size, target_price, desired_stock, preferred_store, image_url")
    .eq("household_id", householdId)
    .eq("is_basis", true)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ProductRow[];
}

async function loadBasisProducts(supabase: ReturnType<typeof getSupabaseAdmin>, householdId: string) {
  const { data: householdProductsData, error: householdProductsError } = await supabase
    .from("household_products")
    .select("product_id, desired_stock, target_price, preferred_store")
    .eq("household_id", householdId)
    .eq("is_basis", true);

  if (householdProductsError) {
    console.warn("[api/dashboard/basis-prices] household_products lookup failed, falling back to products.is_basis", householdProductsError.message);
    return loadLegacyBasisProducts(supabase, householdId);
  }

  const householdProducts = ((householdProductsData ?? []) as HouseholdProductRow[]).filter((item) => item.product_id);

  if (!householdProducts.length) {
    return loadLegacyBasisProducts(supabase, householdId);
  }

  const householdProductByProductId = new Map(householdProducts.map((item) => [item.product_id, item]));
  const productIds = householdProducts.map((item) => item.product_id);

  const { data: productsData, error: productsError } = await supabase
    .from("products")
    .select("id, name, brand, package_size, target_price, desired_stock, preferred_store, image_url")
    .in("id", productIds)
    .order("name", { ascending: true });

  if (productsError) throw productsError;

  const products = ((productsData ?? []) as ProductRow[]).map((product) => {
    const householdProduct = householdProductByProductId.get(product.id);

    return {
      ...product,
      target_price: householdProduct?.target_price ?? product.target_price,
      desired_stock: householdProduct?.desired_stock ?? product.desired_stock,
      preferred_store: householdProduct?.preferred_store ?? product.preferred_store
    };
  });

  return products.length ? products : loadLegacyBasisProducts(supabase, householdId);
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);
    const now = new Date();

    const products = await loadBasisProducts(supabase, householdId);
    const productIds = products.map((product) => product.id);

    if (!productIds.length) {
      return NextResponse.json({
        data: {
          products: [],
          stores: [],
          bestStore: null,
          mostExpensiveStore: null,
          potentialSaving: 0,
          productCount: 0,
          pricedProductCount: 0,
          storeCount: 0
        }
      });
    }

    const [
      { data: inventoryData, error: inventoryError },
      { data: observationsData, error: observationsError },
      { data: storePreferencesData, error: storePreferencesError }
    ] = await Promise.all([
      supabase
        .from("inventory_items")
        .select("product_id, quantity, desired_quantity")
        .eq("household_id", householdId)
        .in("product_id", productIds),
      supabase
        .from("price_observations")
        .select("product_id, store_code, store_name, price, unit_price, observed_at")
        .in("product_id", productIds)
        .order("observed_at", { ascending: false })
        .limit(1500),
      supabase
        .from("household_store_preferences")
        .select("store_key, store_name, priority, is_enabled")
        .eq("household_id", householdId)
    ]);

    if (inventoryError) throw inventoryError;
    if (observationsError) throw observationsError;
    if (storePreferencesError) throw storePreferencesError;

    const storePreferences = new Map<string, StorePreferenceRow>();
    for (const preference of (storePreferencesData ?? []) as StorePreferenceRow[]) {
      storePreferences.set(String(preference.store_key).trim().toLowerCase(), {
        ...preference,
        store_key: String(preference.store_key).trim().toLowerCase()
      });
    }

    function preferenceFor(observation: Pick<PriceObservationRow, "store_code" | "store_name">) {
      const key = storeKey(observation);
      return storePreferences.get(key) ?? {
        store_key: key,
        store_name: observation.store_name,
        priority: 100,
        is_enabled: true
      };
    }

    const inventoryByProduct = new Map<string, InventoryRow>();
    for (const item of (inventoryData ?? []) as InventoryRow[]) {
      if (!item.product_id) continue;
      const existing = inventoryByProduct.get(item.product_id);
      if (!existing) {
        inventoryByProduct.set(item.product_id, item);
        continue;
      }

      inventoryByProduct.set(item.product_id, {
        product_id: item.product_id,
        quantity: toNumber(existing.quantity) + toNumber(item.quantity),
        desired_quantity: Math.max(toNumber(existing.desired_quantity), toNumber(item.desired_quantity))
      });
    }

    const latestByProductStore = new Map<string, PriceObservationRow>();
    for (const observation of (observationsData ?? []) as PriceObservationRow[]) {
      const key = observationKey(observation);
      if (!latestByProductStore.has(key)) {
        latestByProductStore.set(key, observation);
      }
    }

    const pricesByProduct = new Map<string, PriceObservationRow[]>();
    const allStores = new Map<string, { store: string; priority: number; isEnabled: boolean }>();

    for (const observation of latestByProductStore.values()) {
      const freshness = priceFreshness(observation.observed_at, now);
      if (!freshness) continue;

      const preference = preferenceFor(observation);
      if (preference.is_enabled === false) continue;

      const key = storeKey(observation);
      const rows = pricesByProduct.get(observation.product_id) ?? [];
      rows.push(observation);
      pricesByProduct.set(observation.product_id, rows);
      allStores.set(key, {
        store: preference.store_name || observation.store_name,
        priority: toNumber(preference.priority, 100),
        isEnabled: Boolean(preference.is_enabled ?? true)
      });
    }

    const productComparisons: ProductComparison[] = products.map((product) => {
      const inventory = inventoryByProduct.get(product.id);
      const desiredQuantity = Math.max(
        1,
        toNumber(inventory?.desired_quantity, toNumber(product.desired_stock, 1))
      );
      const currentQuantity = toNumber(inventory?.quantity, 0);
      const observations = pricesByProduct.get(product.id) ?? [];
      const freshObservations = observations.filter((observation) => (
        priceFreshness(observation.observed_at, now) === "fresh"
      ));
      const sortedPrices = [...freshObservations].sort((a, b) => {
        const priceDiff = toNumber(a.price) - toNumber(b.price);
        if (priceDiff !== 0) return priceDiff;
        const priorityDiff = toNumber(preferenceFor(a).priority, 100) - toNumber(preferenceFor(b).priority, 100);
        if (priorityDiff !== 0) return priorityDiff;
        return a.store_name.localeCompare(b.store_name, "nb");
      });
      const lowest = sortedPrices[0] ?? null;
      const highest = sortedPrices[sortedPrices.length - 1] ?? null;
      const storePrices: Record<string, number> = {};
      const freshStorePrices: Record<string, number> = {};
      const storePriceAgeDays: Record<string, number> = {};
      const storePriceFreshness: Record<string, PriceFreshness> = {};

      for (const observation of observations) {
        const preference = preferenceFor(observation);
        const key = storeKey(observation);
        const freshness = priceFreshness(observation.observed_at, now);
        if (!freshness) continue;

        storePrices[key] = toNumber(observation.price);
        storePriceAgeDays[key] = priceAgeDays(observation.observed_at, now);
        storePriceFreshness[key] = freshness;

        if (freshness === "fresh") {
          freshStorePrices[key] = toNumber(observation.price);
        }
      }

      return {
        productId: product.id,
        name: product.name,
        subtitle: [product.brand, product.package_size].filter(Boolean).join(" · "),
        desiredQuantity,
        currentQuantity,
        targetPrice: product.target_price,
        lowestStore: lowest ? (preferenceFor(lowest).store_name || lowest.store_name) : null,
        lowestStoreKey: lowest ? storeKey(lowest) : null,
        lowestPrice: lowest ? toNumber(lowest.price) : null,
        highestPrice: highest ? toNumber(highest.price) : null,
        saving: lowest && highest ? Math.max(0, toNumber(highest.price) - toNumber(lowest.price)) : null,
        storePrices,
        freshStorePrices,
        storePriceAgeDays,
        storePriceFreshness,
        imageUrl: product.image_url
      };
    });

    const storeComparisons: StoreComparison[] = [...allStores.entries()].map(([key, meta]) => {
      let total = 0;
      let matchedProducts = 0;

      for (const product of productComparisons) {
        const price = product.freshStorePrices[key];
        if (price === undefined) continue;
        total += price * product.desiredQuantity;
        matchedProducts += 1;
      }

      const productCount = productComparisons.length;
      const coveragePct = productCount > 0 ? Math.round((matchedProducts / productCount) * 100) : 0;

      return {
        store: meta.store,
        storeKey: key,
        priority: meta.priority,
        isEnabled: meta.isEnabled,
        total,
        matchedProducts,
        productCount,
        coveragePct,
        missingProducts: productCount - matchedProducts
      };
    }).sort((a, b) => {
      if (b.matchedProducts !== a.matchedProducts) return b.matchedProducts - a.matchedProducts;
      const totalDiff = a.total - b.total;
      if (totalDiff !== 0) return totalDiff;
      const priorityDiff = a.priority - b.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return a.store.localeCompare(b.store, "nb");
    });

    const completeStores = storeComparisons.filter((store) => store.matchedProducts === productComparisons.length);
    const comparableStores = completeStores.length ? completeStores : storeComparisons;
    const bestStore = comparableStores[0] ?? null;
    const mostExpensiveStore = comparableStores.length
      ? [...comparableStores].sort((a, b) => b.total - a.total)[0]
      : null;
    const potentialSaving = bestStore && mostExpensiveStore
      ? Math.max(0, mostExpensiveStore.total - bestStore.total)
      : 0;

    return NextResponse.json({
      data: {
        products: productComparisons,
        stores: storeComparisons,
        bestStore,
        mostExpensiveStore,
        potentialSaving,
        productCount: productComparisons.length,
        pricedProductCount: productComparisons.filter((product) => product.lowestPrice !== null).length,
        storeCount: storeComparisons.length
      }
    });
  } catch (error) {
    console.error("[api/dashboard/basis-prices] GET feilet", error);
    return apiErrorResponse(error);
  }
}
