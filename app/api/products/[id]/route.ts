import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { unitPricingColumnsForProduct } from "@/lib/unit-pricing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

type ProductRow = Record<string, any> & {
  id: string;
  name: string;
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

type ProductGroupProductRow = {
  id: string;
  ean: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
};

type ProductGroupMemberRow = {
  product_id: string;
  products?: ProductGroupProductRow | ProductGroupProductRow[] | null;
};

type ProductGroupRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
  product_group_members?: ProductGroupMemberRow[] | null;
};

type ProductGroupPriceOption = {
  product_id: string;
  product_name: string;
  ean: string | null;
  package_size: string | null;
  store_name: string;
  store_code: string | null;
  price: number | null;
  unit_price: number | null;
  comparison_unit: string | null;
  observed_at: string | null;
  source: string | null;
  source_url: string | null;
  age_days: number | null;
  freshness: "fresh" | "check";
  is_scanned_product: boolean;
};

type ProductGroupSummary = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
  package_count: number;
  cheapest: ProductGroupPriceOption | null;
  scanned_product_best_price: ProductGroupPriceOption | null;
  price_options: ProductGroupPriceOption[];
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

function toNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function correctedPriceObservation<T extends Record<string, any>>(product: ProductRow, observation: T): T & { stored_unit_price: number | null; recomputed_unit_price: number | null; unit_price_was_corrected: boolean } {
  const price = toNumber(observation.price);
  const storedUnitPrice = toNumber(observation.unit_price);
  const recomputed = unitPricingColumnsForProduct(
    {
      name: product.name,
      brand: product.brand ?? null,
      category: product.category ?? null,
      package_size: product.package_size ?? null,
      net_content_value: product.net_content_value ?? null,
      net_content_unit: product.net_content_unit ?? null,
      comparison_unit: observation.comparison_unit ?? product.comparison_unit ?? null
    },
    price
  );

  const recomputedUnitPrice = toNumber(recomputed.unit_price);
  let unitPrice = storedUnitPrice;
  let corrected = false;

  if (recomputedUnitPrice !== null) {
    if (storedUnitPrice === null) {
      unitPrice = recomputedUnitPrice;
      corrected = true;
    } else {
      const diffRatio = Math.abs(storedUnitPrice - recomputedUnitPrice) / Math.max(recomputedUnitPrice, 0.01);
      if (diffRatio > 0.30) {
        unitPrice = recomputedUnitPrice;
        corrected = true;
      }
    }
  }

  return {
    ...observation,
    unit_price: unitPrice,
    comparison_unit: recomputed.comparison_unit ?? observation.comparison_unit ?? null,
    package_quantity: recomputed.package_quantity ?? observation.package_quantity ?? null,
    package_unit: recomputed.package_unit ?? observation.package_unit ?? null,
    stored_unit_price: storedUnitPrice,
    recomputed_unit_price: recomputedUnitPrice,
    unit_price_was_corrected: corrected
  };
}

function firstGroupProduct(value: ProductGroupProductRow | ProductGroupProductRow[] | null | undefined) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function productGroupUnitPrice(product: ProductGroupProductRow | null, price: number | null, comparisonUnit: string | null) {
  if (!product || price === null || !comparisonUnit) return null;
  const computed = unitPricingColumnsForProduct(
    {
      name: product.name,
      brand: product.brand,
      category: product.category,
      package_size: product.package_size,
      comparison_unit: comparisonUnit
    },
    price
  );
  return computed.comparison_unit === comparisonUnit ? toNumber(computed.unit_price) : null;
}

const CURRENT_PRICE_GREEN_DAYS = 30;
const CURRENT_PRICE_YELLOW_DAYS = 45;

function priceAgeDays(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

function priceFreshness(value: string | null): "fresh" | "check" {
  const ageDays = priceAgeDays(value);
  return ageDays !== null && ageDays <= 30 ? "fresh" : "check";
}

function isCurrentPrice(value: string | null) {
  const ageDays = priceAgeDays(value);
  return ageDays !== null && ageDays <= CURRENT_PRICE_YELLOW_DAYS;
}

function currentPriceRank(value: string | null) {
  const ageDays = priceAgeDays(value);
  if (ageDays === null) return 9;
  if (ageDays <= CURRENT_PRICE_GREEN_DAYS) return 0;
  if (ageDays <= CURRENT_PRICE_YELLOW_DAYS) return 1;
  return 9;
}

function currentPriceFreshness(value: string | null): "fresh" | "check" {
  return currentPriceRank(value) === 0 ? "fresh" : "check";
}

async function loadProductGroupSummary(productId: string): Promise<ProductGroupSummary | null> {
  const supabase = getSupabaseAdmin();

  const { data: memberships, error: membershipError } = await supabase
    .from("product_group_members")
    .select("group_id")
    .eq("product_id", productId)
    .limit(1);

  if (membershipError) throw membershipError;
  const groupId = (memberships?.[0] as { group_id?: string } | undefined)?.group_id;
  if (!groupId) return null;

  const { data: groupData, error: groupError } = await supabase
    .from("product_groups")
    .select(`
      id,
      name,
      brand,
      category,
      comparison_unit,
      product_group_members (
        product_id,
        products (
          id,
          ean,
          name,
          brand,
          category,
          package_size,
          image_url
        )
      )
    `)
    .eq("id", groupId)
    .neq("status", "archived")
    .maybeSingle();

  if (groupError) throw groupError;
  if (!groupData) return null;

  const group = groupData as unknown as ProductGroupRow;
  const productMap = new Map<string, ProductGroupProductRow>();
  const productIds = (group.product_group_members ?? [])
    .map((member) => {
      const memberProductId = String(member.product_id);
      const memberProduct = firstGroupProduct(member.products);
      if (memberProduct) productMap.set(memberProductId, memberProduct);
      return memberProductId;
    })
    .filter(Boolean);

  if (!productIds.length) return null;

  const { data: observations, error: observationError } = await supabase
    .from("price_observations")
    .select("id, product_id, store_code, store_name, price, unit_price, comparison_unit, package_quantity, package_unit, observed_at, source, source_url")
    .in("product_id", productIds)
    .not("price", "is", null)
    .order("observed_at", { ascending: false })
    .limit(500);

  if (observationError) throw observationError;

  const latestByProductStore = new Map<string, Record<string, any>>();
  for (const observation of (observations ?? []) as Array<Record<string, any>>) {
    const key = `${observation.product_id}:${observation.store_code ?? observation.store_name ?? "unknown"}`;
    if (!latestByProductStore.has(key)) latestByProductStore.set(key, observation);
  }

  const priceOptions = [...latestByProductStore.values()]
    .map((observation) => {
      const memberProduct = productMap.get(String(observation.product_id)) ?? null;
      const price = toNumber(observation.price);
      const storedUnitPrice = toNumber(observation.unit_price);
      const comparisonUnit = String(observation.comparison_unit ?? group.comparison_unit ?? "") || null;
      const recomputedUnitPrice = productGroupUnitPrice(memberProduct, price, comparisonUnit);
      let unitPrice = storedUnitPrice;
      if (recomputedUnitPrice !== null) {
        if (storedUnitPrice === null) unitPrice = recomputedUnitPrice;
        else {
          const diffRatio = Math.abs(storedUnitPrice - recomputedUnitPrice) / Math.max(recomputedUnitPrice, 0.01);
          if (diffRatio > 0.30) unitPrice = recomputedUnitPrice;
        }
      }

      return {
        product_id: String(observation.product_id),
        product_name: memberProduct?.name ?? "Ukjent forpakning",
        ean: memberProduct?.ean ?? null,
        package_size: memberProduct?.package_size ?? null,
        store_name: String(observation.store_name ?? observation.store_code ?? "Ukjent butikk"),
        store_code: observation.store_code ?? null,
        price,
        unit_price: unitPrice,
        comparison_unit: comparisonUnit,
        observed_at: observation.observed_at ?? null,
        source: observation.source ?? null,
        source_url: observation.source_url ?? null,
        age_days: priceAgeDays(observation.observed_at),
        freshness: priceFreshness(observation.observed_at),
        is_scanned_product: String(observation.product_id) === productId
      } satisfies ProductGroupPriceOption;
    })
    .filter((option) => option.price !== null && option.unit_price !== null)
    .sort((a, b) => {
      const unitDiff = (a.unit_price ?? Number.POSITIVE_INFINITY) - (b.unit_price ?? Number.POSITIVE_INFINITY);
      if (unitDiff !== 0) return unitDiff;
      return String(b.observed_at ?? "").localeCompare(String(a.observed_at ?? ""));
    });

  return {
    id: group.id,
    name: group.name,
    brand: group.brand,
    category: group.category,
    comparison_unit: group.comparison_unit,
    package_count: productIds.length,
    cheapest: priceOptions[0] ?? null,
    scanned_product_best_price: priceOptions.find((option) => option.is_scanned_product) ?? null,
    price_options: priceOptions.slice(0, 8)
  };
}

function toBoolean(value: unknown) {
  return value === true || value === "true" || value === "on";
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
    household_product_id: householdProduct?.id ?? null,
    household_product_updated_at: householdProduct?.updated_at ?? null
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
      .select("id, store_code, store_name, price, unit_price, comparison_unit, package_quantity, package_unit, observed_at, source, source_url")
      .eq("product_id", id)
      .order("observed_at", { ascending: false })
      .limit(80);

    if (priceResult.error) throw priceResult.error;

    const correctedObservations = (priceResult.data ?? []).map((observation) => correctedPriceObservation(product, observation));
    const productGroup = await loadProductGroupSummary(id);

    const latestByStore = new Map<string, { store_name: string; price: number; unit_price: number | null; comparison_unit: string | null; observed_at: string; source: string | null; source_url: string | null }>();
    for (const observation of correctedObservations) {
      const key = observation.store_code || observation.store_name;
      const existing = latestByStore.get(key);
      if (!existing || String(observation.observed_at) > String(existing.observed_at)) {
        latestByStore.set(key, {
          store_name: observation.store_name,
          price: observation.price,
          unit_price: observation.unit_price,
          comparison_unit: observation.comparison_unit ?? null,
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
        price_observations: correctedObservations,
        latest_by_store: Array.from(latestByStore.values()).sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at))),
        product_group: productGroup
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
      package_size: body.package_size ? String(body.package_size).trim() : null
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
