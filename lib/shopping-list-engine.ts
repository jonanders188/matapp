import { ensureDefaultHousehold } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type Household = { id: string; name: string };

async function resolveHousehold(householdId?: string): Promise<Household> {
  if (householdId) return { id: householdId, name: "Familien" };
  return ensureDefaultHousehold();
}

type RecommendationRow = {
  id: string;
  household_id: string;
  product_id: string;
  action: "buy" | "stock_up" | "wait" | "use_up" | "switch_brand";
  store_name: string | null;
  price: number | null;
  estimated_saving: number | null;
  reason: string;
  created_at: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  target_price: number | null;
  desired_stock: number | null;
  preferred_store: string | null;
};

type ObservationRow = {
  product_id: string;
  store_name: string;
  price: number;
  observed_at: string;
};

type InventoryRow = {
  product_id: string;
  quantity: number | null;
  desired_quantity: number | null;
};

type ShoppingListItemInput = {
  household_id: string;
  product_id: string;
  recommendation_id: string | null;
  product_name: string;
  store_name: string | null;
  quantity: number;
  estimated_price: number | null;
  estimated_saving: number | null;
  status: "planned" | "skipped";
  reason: string;
};

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function pickStore(recommendation: RecommendationRow, observations: ObservationRow[], product: ProductRow | undefined) {
  if (recommendation.store_name) return recommendation.store_name;
  const lowest = observations.sort((a, b) => a.price - b.price)[0];
  return lowest?.store_name ?? product?.preferred_store ?? null;
}

function pickPrice(recommendation: RecommendationRow, observations: ObservationRow[]) {
  if (recommendation.price !== null && recommendation.price !== undefined) return recommendation.price;
  const lowest = observations.sort((a, b) => a.price - b.price)[0];
  return lowest?.price ?? null;
}

function quantityFromStock(product: ProductRow | undefined, inventoryRows: InventoryRow[]) {
  const current = inventoryRows.reduce((sum, row) => sum + toNumber(row.quantity), 0);
  const desiredFromInventory = Math.max(0, ...inventoryRows.map((row) => toNumber(row.desired_quantity)));
  const desired = desiredFromInventory || toNumber(product?.desired_stock, 1) || 1;
  return Math.max(1, Math.ceil(desired - current));
}

export async function getCurrentShoppingList(householdId?: string) {
  const supabase = getSupabaseAdmin();
  const household = await resolveHousehold(householdId);

  const listResult = await supabase
    .from("shopping_lists")
    .select("id, household_id, title, status, max_stores, estimated_total, estimated_saving, created_at, updated_at")
    .eq("household_id", household.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (listResult.error) throw listResult.error;
  const list = listResult.data?.[0] ?? null;

  if (!list) {
    return { household, list: null, items: [] };
  }

  const itemsResult = await supabase
    .from("shopping_list_items")
    .select("id, shopping_list_id, product_id, recommendation_id, product_name, store_name, quantity, estimated_price, estimated_saving, status, reason, created_at")
    .eq("shopping_list_id", list.id)
    .order("store_name", { ascending: true })
    .order("product_name", { ascending: true });

  if (itemsResult.error) throw itemsResult.error;

  const items = itemsResult.data ?? [];
  const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))];

  if (!productIds.length) {
    return { household, list, items };
  }

  const productsResult = await supabase
    .from("products")
    .select("id, image_url")
    .in("id", productIds);

  if (productsResult.error) throw productsResult.error;

  const imageByProductId = new Map((productsResult.data ?? []).map((product) => [product.id, product.image_url]));

  return {
    household,
    list,
    items: items.map((item) => ({
      ...item,
      product_image_url: imageByProductId.get(item.product_id) ?? null
    }))
  };
}

export async function generateShoppingList(options?: { maxStores?: number; householdId?: string }) {
  const supabase = getSupabaseAdmin();
  const household = await resolveHousehold(options?.householdId);
  const maxStores = Math.max(1, Math.min(options?.maxStores ?? 2, 5));

  const recommendationsResult = await supabase
    .from("recommendations")
    .select("id, household_id, product_id, action, store_name, price, estimated_saving, reason, created_at")
    .eq("household_id", household.id)
    .in("action", ["buy", "stock_up"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (recommendationsResult.error) throw recommendationsResult.error;

  const recommendations = (recommendationsResult.data ?? []) as RecommendationRow[];
  const productIds = [...new Set(recommendations.map((recommendation) => recommendation.product_id).filter(Boolean))];

  if (!productIds.length) {
    const list = await supabase
      .from("shopping_lists")
      .insert({
        household_id: household.id,
        title: "Smart handleliste",
        status: "active",
        max_stores: maxStores,
        estimated_total: 0,
        estimated_saving: 0
      })
      .select("id, household_id, title, status, max_stores, estimated_total, estimated_saving, created_at, updated_at")
      .limit(1);

    if (list.error) throw list.error;
    return { household, list: list.data?.[0] ?? null, items: [] };
  }

  const [productsResult, observationsResult, inventoryResult] = await Promise.all([
    supabase.from("products").select("id, name, brand, category, image_url, target_price, desired_stock, preferred_store").in("id", productIds),
    supabase.from("price_observations").select("product_id, store_name, price, observed_at").in("product_id", productIds).order("observed_at", { ascending: false }),
    supabase.from("inventory_items").select("product_id, quantity, desired_quantity").eq("household_id", household.id).in("product_id", productIds)
  ]);

  if (productsResult.error) throw productsResult.error;
  if (observationsResult.error) throw observationsResult.error;
  if (inventoryResult.error) throw inventoryResult.error;

  const productById = new Map((productsResult.data ?? []).map((product) => [product.id, product as ProductRow]));
  const observationsByProduct = new Map<string, ObservationRow[]>();
  const inventoryByProduct = new Map<string, InventoryRow[]>();

  for (const observation of (observationsResult.data ?? []) as ObservationRow[]) {
    const rows = observationsByProduct.get(observation.product_id) ?? [];
    rows.push(observation);
    observationsByProduct.set(observation.product_id, rows);
  }

  for (const item of (inventoryResult.data ?? []) as InventoryRow[]) {
    const rows = inventoryByProduct.get(item.product_id) ?? [];
    rows.push(item);
    inventoryByProduct.set(item.product_id, rows);
  }

  const candidates: ShoppingListItemInput[] = recommendations.map((recommendation) => {
    const product = productById.get(recommendation.product_id);
    const observations = observationsByProduct.get(recommendation.product_id) ?? [];
    const inventoryRows = inventoryByProduct.get(recommendation.product_id) ?? [];
    const storeName = pickStore(recommendation, observations, product);
    const price = pickPrice(recommendation, observations);
    const quantity = recommendation.action === "stock_up" ? Math.max(2, quantityFromStock(product, inventoryRows)) : quantityFromStock(product, inventoryRows);

    return {
      household_id: household.id,
      product_id: recommendation.product_id,
      recommendation_id: recommendation.id,
      product_name: product?.name ?? "Ukjent produkt",
      store_name: storeName,
      quantity,
      estimated_price: price !== null ? price * quantity : null,
      estimated_saving: recommendation.estimated_saving !== null && recommendation.estimated_saving !== undefined ? recommendation.estimated_saving * quantity : null,
      status: "planned",
      reason: recommendation.reason
    };
  });

  const storeStats = new Map<string, { storeName: string; itemCount: number; total: number; saving: number }>();

  for (const item of candidates) {
    const storeName = item.store_name ?? "Ukjent butikk";
    const current = storeStats.get(storeName) ?? { storeName, itemCount: 0, total: 0, saving: 0 };
    current.itemCount += 1;
    current.total += toNumber(item.estimated_price);
    current.saving += toNumber(item.estimated_saving);
    storeStats.set(storeName, current);
  }

  const selectedStores = new Set(
    [...storeStats.values()]
      .sort((a, b) => b.itemCount - a.itemCount || b.saving - a.saving || a.total - b.total)
      .slice(0, maxStores)
      .map((store) => store.storeName)
  );

  const items = candidates.map((item) => {
    const storeName = item.store_name ?? "Ukjent butikk";
    if (selectedStores.has(storeName)) return item;
    return {
      ...item,
      status: "skipped" as const,
      reason: `${item.reason} Ikke lagt inn fordi butikken ikke er blant de ${maxStores} beste stoppene.`
    };
  });

  const plannedItems = items.filter((item) => item.status === "planned");
  const estimatedTotal = plannedItems.reduce((sum, item) => sum + toNumber(item.estimated_price), 0);
  const estimatedSaving = plannedItems.reduce((sum, item) => sum + toNumber(item.estimated_saving), 0);

  const listResult = await supabase
    .from("shopping_lists")
    .insert({
      household_id: household.id,
      title: "Smart handleliste",
      status: "active",
      max_stores: maxStores,
      estimated_total: estimatedTotal,
      estimated_saving: estimatedSaving
    })
    .select("id, household_id, title, status, max_stores, estimated_total, estimated_saving, created_at, updated_at")
    .limit(1);

  if (listResult.error) throw listResult.error;
  const list = listResult.data?.[0];

  if (!list) {
    throw new Error("Kunne ikke opprette handleliste");
  }

  if (items.length) {
    const insertResult = await supabase.from("shopping_list_items").insert(
      items.map((item) => ({
        shopping_list_id: list.id,
        household_id: household.id,
        product_id: item.product_id,
        recommendation_id: item.recommendation_id,
        product_name: item.product_name,
        store_name: item.store_name,
        quantity: item.quantity,
        estimated_price: item.estimated_price,
        estimated_saving: item.estimated_saving,
        status: item.status,
        reason: item.reason
      }))
    );

    if (insertResult.error) throw insertResult.error;
  }

  const current = await getCurrentShoppingList();
  return current;
}
