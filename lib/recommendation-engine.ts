import { ensureDefaultHousehold } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ProductRow = {
  id: string;
  household_id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  target_price: number | null;
  target_price_unit: string | null;
  desired_stock: number | null;
  is_basis: boolean | null;
  is_freezable: boolean | null;
  preferred_store: string | null;
  created_at?: string | null;
};

type InventoryRow = {
  product_id: string;
  quantity: number | null;
  desired_quantity: number | null;
  location: string | null;
  expires_at: string | null;
};

type ObservationRow = {
  product_id: string;
  store_name: string;
  price: number;
  unit_price: number | null;
  observed_at: string;
};

export type RecommendationAction = "buy" | "wait" | "stock_up" | "use_up" | "switch_brand";

export type RecommendationCandidate = {
  household_id: string;
  product_id: string;
  action: RecommendationAction;
  store_name: string | null;
  price: number | null;
  estimated_saving: number | null;
  reason: string;
  valid_until: string;
};

export type RecommendationWithProduct = RecommendationCandidate & {
  product_name: string;
  brand: string | null;
  category: string | null;
  target_price: number | null;
  current_stock: number;
  desired_stock: number;
  action_label: string;
  score: number;
};

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function actionLabel(action: RecommendationAction) {
  switch (action) {
    case "buy":
      return "Kjøp nå";
    case "stock_up":
      return "Hamstre";
    case "wait":
      return "Vent";
    case "use_up":
      return "Bruk opp";
    case "switch_brand":
      return "Bytt alternativ";
    default:
      return action;
  }
}

function categoryBoost(product: ProductRow) {
  const category = `${product.category ?? ""} ${product.name}`.toLowerCase();
  if (category.includes("hygiene") || category.includes("hushold") || category.includes("barn")) return 8;
  if (category.includes("frys") || category.includes("protein") || product.is_freezable) return 7;
  if (category.includes("italiensk") || category.includes("tomat") || category.includes("pasta")) return 6;
  if (product.is_basis) return 5;
  return 0;
}

function sortByImportance(a: RecommendationWithProduct, b: RecommendationWithProduct) {
  return b.score - a.score || a.product_name.localeCompare(b.product_name, "nb");
}

export async function calculateRecommendations() {
  const supabase = getSupabaseAdmin();
  const household = await ensureDefaultHousehold();

  const productsResult = await supabase
    .from("products")
    .select("id, household_id, name, brand, ean, category, target_price, target_price_unit, desired_stock, is_basis, is_freezable, preferred_store, created_at")
    .eq("household_id", household.id)
    .order("created_at", { ascending: false });

  if (productsResult.error) throw productsResult.error;

  const products = (productsResult.data ?? []) as ProductRow[];
  const productIds = products.map((product) => product.id);

  if (!productIds.length) {
    return { household, recommendations: [] as RecommendationWithProduct[] };
  }

  const inventoryResult = await supabase
    .from("inventory_items")
    .select("product_id, quantity, desired_quantity, location, expires_at")
    .eq("household_id", household.id)
    .in("product_id", productIds);

  if (inventoryResult.error) throw inventoryResult.error;

  const observationsResult = await supabase
    .from("price_observations")
    .select("product_id, store_name, price, unit_price, observed_at")
    .in("product_id", productIds)
    .order("observed_at", { ascending: false });

  if (observationsResult.error) throw observationsResult.error;

  const inventoryByProduct = new Map<string, InventoryRow[]>();
  for (const item of (inventoryResult.data ?? []) as InventoryRow[]) {
    const rows = inventoryByProduct.get(item.product_id) ?? [];
    rows.push(item);
    inventoryByProduct.set(item.product_id, rows);
  }

  const latestObservation = new Map<string, ObservationRow>();
  const lowestRecentObservation = new Map<string, ObservationRow>();

  for (const observation of (observationsResult.data ?? []) as ObservationRow[]) {
    if (!latestObservation.has(observation.product_id)) {
      latestObservation.set(observation.product_id, observation);
    }

    const currentLowest = lowestRecentObservation.get(observation.product_id);
    if (!currentLowest || observation.price < currentLowest.price) {
      lowestRecentObservation.set(observation.product_id, observation);
    }
  }

  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const recommendations: RecommendationWithProduct[] = [];

  for (const product of products) {
    const inventoryRows = inventoryByProduct.get(product.id) ?? [];
    const currentStock = inventoryRows.reduce((sum, row) => sum + toNumber(row.quantity), 0);
    const desiredFromInventory = Math.max(...inventoryRows.map((row) => toNumber(row.desired_quantity)), 0);
    const desiredStock = desiredFromInventory || toNumber(product.desired_stock, product.is_basis ? 2 : 1);
    const latest = latestObservation.get(product.id) ?? null;
    const lowest = lowestRecentObservation.get(product.id) ?? latest;
    const price = lowest?.price ?? latest?.price ?? null;
    const storeName = lowest?.store_name ?? latest?.store_name ?? product.preferred_store ?? null;
    const targetPrice = toNumber(product.target_price, 0);
    const isLowStock = desiredStock > 0 && currentStock < desiredStock;
    const isEmpty = desiredStock > 0 && currentStock <= 0;
    const isOverstocked = desiredStock > 0 && currentStock >= desiredStock * 2;
    const priceUnderTarget = targetPrice > 0 && price !== null && price <= targetPrice;
    const priceFarUnderTarget = targetPrice > 0 && price !== null && price <= targetPrice * 0.85;
    const priceOverTarget = targetPrice > 0 && price !== null && price > targetPrice * 1.1;
    const estimatedSaving = targetPrice > 0 && price !== null ? Math.max(targetPrice - price, 0) : null;
    const baseScore = categoryBoost(product);

    let recommendation: Omit<RecommendationWithProduct, "product_name" | "brand" | "category" | "target_price" | "current_stock" | "desired_stock" | "action_label"> | null = null;

    if (isLowStock && priceUnderTarget) {
      recommendation = {
        household_id: household.id,
        product_id: product.id,
        action: priceFarUnderTarget ? "stock_up" : "buy",
        store_name: storeName,
        price,
        estimated_saving: estimatedSaving,
        reason: `${product.name} er under målpris og lageret er lavt (${currentStock}/${desiredStock}).`,
        valid_until: validUntil,
        score: 90 + baseScore + (isEmpty ? 10 : 0) + (priceFarUnderTarget ? 8 : 0)
      };
    } else if (isLowStock && targetPrice === 0 && price !== null) {
      recommendation = {
        household_id: household.id,
        product_id: product.id,
        action: "buy",
        store_name: storeName,
        price,
        estimated_saving: null,
        reason: `${product.name} er under ønsket lager (${currentStock}/${desiredStock}).`,
        valid_until: validUntil,
        score: 72 + baseScore + (isEmpty ? 10 : 0)
      };
    } else if (priceFarUnderTarget && (product.is_basis || product.is_freezable || currentStock < desiredStock * 1.5)) {
      recommendation = {
        household_id: household.id,
        product_id: product.id,
        action: "stock_up",
        store_name: storeName,
        price,
        estimated_saving: estimatedSaving,
        reason: `${product.name} er tydelig under målpris. Egner seg til påfyll/hamstring.`,
        valid_until: validUntil,
        score: 82 + baseScore
      };
    } else if (isOverstocked) {
      recommendation = {
        household_id: household.id,
        product_id: product.id,
        action: "use_up",
        store_name: null,
        price: null,
        estimated_saving: null,
        reason: `Dere har mer enn ønsket lager av ${product.name}. Bruk opp før dere kjøper mer.`,
        valid_until: validUntil,
        score: 58 + baseScore
      };
    } else if (priceOverTarget && currentStock >= desiredStock) {
      recommendation = {
        household_id: household.id,
        product_id: product.id,
        action: "wait",
        store_name: storeName,
        price,
        estimated_saving: null,
        reason: `${product.name} er over målpris og lageret ser tilstrekkelig ut. Vent på bedre pris.`,
        valid_until: validUntil,
        score: 45 + baseScore
      };
    } else if (isLowStock) {
      recommendation = {
        household_id: household.id,
        product_id: product.id,
        action: "buy",
        store_name: storeName,
        price,
        estimated_saving: estimatedSaving,
        reason: `${product.name} bør fylles på fordi lageret er lavt (${currentStock}/${desiredStock}).`,
        valid_until: validUntil,
        score: 68 + baseScore + (isEmpty ? 10 : 0)
      };
    }

    if (recommendation) {
      recommendations.push({
        ...recommendation,
        product_name: product.name,
        brand: product.brand,
        category: product.category,
        target_price: product.target_price,
        current_stock: currentStock,
        desired_stock: desiredStock,
        action_label: actionLabel(recommendation.action)
      });
    }
  }

  return {
    household,
    recommendations: recommendations.sort(sortByImportance).slice(0, 60)
  };
}

export async function saveRecommendations() {
  const supabase = getSupabaseAdmin();
  const { household, recommendations } = await calculateRecommendations();

  const deleteResult = await supabase.from("recommendations").delete().eq("household_id", household.id);
  if (deleteResult.error) throw deleteResult.error;

  if (!recommendations.length) {
    return { household, recommendations: [] as RecommendationWithProduct[] };
  }

  const rows: RecommendationCandidate[] = recommendations.map((recommendation) => ({
    household_id: recommendation.household_id,
    product_id: recommendation.product_id,
    action: recommendation.action,
    store_name: recommendation.store_name,
    price: recommendation.price,
    estimated_saving: recommendation.estimated_saving,
    reason: recommendation.reason,
    valid_until: recommendation.valid_until
  }));

  const insertResult = await supabase.from("recommendations").insert(rows).select("id, product_id, action, store_name, price, estimated_saving, reason, valid_until, created_at");
  if (insertResult.error) throw insertResult.error;

  const byProductId = new Map(recommendations.map((recommendation) => [recommendation.product_id, recommendation]));
  const saved = (insertResult.data ?? []).map((row) => ({
    ...byProductId.get(row.product_id),
    ...row,
    action_label: actionLabel(row.action as RecommendationAction)
  })) as RecommendationWithProduct[];

  return { household, recommendations: saved.sort(sortByImportance) };
}
