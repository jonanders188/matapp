import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import {
  latestPriceDate,
  lookupKassalappProductsWithPricesByEan,
  normalizeCategory,
  packageSize,
  productMetadataPayload,
  type KassalappProduct
} from "@/lib/kassalapp";
import { canonicalStoreIdentity, normalizeStoreCode, priceProductsForProduct } from "@/lib/price-observations";
import { findCanonicalProductByEan, insertProductWithoutDuplicate, PRODUCT_IDENTITY_SELECT } from "@/lib/product-identity";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { unitPricingColumnsForProduct } from "@/lib/unit-pricing";

type SaveMode = "none" | "global" | "basis";

type QuickPriceRequest = {
  ean?: unknown;
  storeKey?: unknown;
  price?: unknown;
  saveMode?: SaveMode;
};

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  desired_stock: number | null;
  target_price?: number | null;
  target_price_unit?: string | null;
  preferred_store?: string | null;
  is_basis: boolean | null;
  is_freezable?: boolean | null;
  notes?: string | null;
};

type StorePreferenceRow = {
  store_key: string | null;
  store_name: string | null;
  is_enabled: boolean | null;
  priority: number | null;
};

type PriceRow = {
  id?: string;
  product_id: string;
  store_code: string | null;
  store_name: string | null;
  price: number | string | null;
  unit_price: number | string | null;
  comparison_unit?: string | null;
  package_quantity?: number | string | null;
  package_unit?: string | null;
  unit_price_source?: string | null;
  observed_at: string | null;
  source: string | null;
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
  comparison_unit: string | null;
  product_group_members?: ProductGroupMemberRow[] | null;
};

type DisplayPrice = {
  storeKey: string;
  storeName: string;
  price: number | null;
  unitPrice: number | null;
  observedAt: string | null;
  source: string | null;
  isFresh: boolean;
};

type QuickGroupPrice = {
  productId: string;
  productName: string;
  brand: string | null;
  ean: string | null;
  packageSize: string | null;
  storeKey: string;
  storeName: string;
  price: number | null;
  unitPrice: number | null;
  storedUnitPrice: number | null;
  unitPriceWasCorrected: boolean;
  comparisonUnit: string | null;
  observedAt: string | null;
  source: string | null;
  ageDays: number | null;
  isFresh: boolean;
  isStale: boolean;
};

type QuickProductGroup = {
  id: string;
  name: string;
  comparisonUnit: string | null;
  packageCount: number;
  scannedPackage: QuickGroupPrice | null;
  cheapest: QuickGroupPrice | null;
  priceOptions: QuickGroupPrice[];
};

const FRESH_PRICE_DAYS = 45;
const FRESH_PRICE_MS = FRESH_PRICE_DAYS * 24 * 60 * 60 * 1000;
const GROUP_FRESH_PRICE_DAYS = 30;
const GROUP_USABLE_PRICE_DAYS = 45;

function cleanEan(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").trim();
}

function toNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function productPayload(product: KassalappProduct, ean: string) {
  return {
    kassalapp_id: product.id,
    ean: cleanEan(product.ean) || ean,
    name: product.name,
    brand: product.brand ?? null,
    category: normalizeCategory(product),
    package_size: packageSize(product),
    image_url: product.image ?? null,
    notes: product.url ?? null,
    ...productMetadataPayload(product)
  };
}

function displaySource(source: string | null) {
  if (!source) return null;
  if (source.startsWith("kassalapp")) return "Kassalapp API";
  if (source === "receipt-scan") return "Kvittering";
  if (source === "shelf-edge" || source === "mobile-scan") return "Hyllekant";
  if (source === "manual") return "Manuelt";
  return source;
}

function isFreshDate(value: string | null) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() - time <= FRESH_PRICE_MS;
}

function priceAgeDays(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

function isFreshGroupPrice(value: string | null) {
  const ageDays = priceAgeDays(value);
  return ageDays !== null && ageDays <= GROUP_FRESH_PRICE_DAYS;
}

function isStaleGroupPrice(value: string | null) {
  const ageDays = priceAgeDays(value);
  return ageDays === null || ageDays > GROUP_FRESH_PRICE_DAYS;
}

function isUsableGroupPrice(value: string | null) {
  const ageDays = priceAgeDays(value);
  return ageDays !== null && ageDays <= GROUP_USABLE_PRICE_DAYS;
}

function groupPriceFreshnessRank(value: string | null) {
  const ageDays = priceAgeDays(value);
  if (ageDays === null) return 9;
  if (ageDays <= GROUP_FRESH_PRICE_DAYS) return 0;
  if (ageDays <= GROUP_USABLE_PRICE_DAYS) return 1;
  return 9;
}

async function loadActiveStores(householdId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("household_store_preferences")
    .select("store_key, store_name, is_enabled, priority")
    .eq("household_id", householdId)
    .eq("is_enabled", true)
    .order("priority", { ascending: true })
    .order("store_name", { ascending: true });

  if (error) throw error;

  const storesByKey = new Map<string, { storeKey: string; storeName: string; priority: number }>();

  for (const row of (data ?? []) as StorePreferenceRow[]) {
    const identity = canonicalStoreIdentity(row.store_key, row.store_name);
    if (!identity.store_code || !identity.store_name) continue;
    const next = {
      storeKey: identity.store_code,
      storeName: identity.store_name,
      priority: Number(row.priority ?? 100)
    };
    const existing = storesByKey.get(next.storeKey);
    if (!existing || next.priority < existing.priority) storesByKey.set(next.storeKey, next);
  }

  return [...storesByKey.values()].sort((a, b) => a.priority - b.priority || a.storeName.localeCompare(b.storeName, "nb"));
}

async function loadHouseholdProduct(householdId: string, productId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("household_products")
    .select("id, is_basis")
    .eq("household_id", householdId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function ensureHouseholdProduct(householdId: string, product: ProductRow) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const existing = await loadHouseholdProduct(householdId, product.id);
  const payload = {
    household_id: householdId,
    product_id: product.id,
    is_basis: true,
    desired_stock: 1,
    target_price: null,
    target_price_unit: "unit",
    preferred_store: null,
    is_freezable: false,
    notes: product.notes ?? null,
    updated_at: now
  };

  const result = existing?.id
    ? await supabase.from("household_products").update(payload).eq("id", existing.id).select("id, is_basis").single()
    : await supabase.from("household_products").insert(payload).select("id, is_basis").single();

  if (result.error) throw result.error;

  return result.data;
}

function emptyStorePrices(stores: Awaited<ReturnType<typeof loadActiveStores>>) {
  return stores.map((store) => ({
    storeKey: store.storeKey,
    storeName: store.storeName,
    price: null,
    unitPrice: null,
    observedAt: null,
    source: null,
    isFresh: false
  } satisfies DisplayPrice));
}

async function pricesFromDatabase(productId: string, stores: Awaited<ReturnType<typeof loadActiveStores>>) {
  if (!stores.length) return [] as DisplayPrice[];
  const activeStoreKeys = new Set(stores.map((store) => store.storeKey));
  const earliest = new Date(Date.now() - FRESH_PRICE_MS).toISOString();
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("price_observations")
    .select("product_id, store_code, store_name, price, unit_price, observed_at, source")
    .eq("product_id", productId)
    .gte("observed_at", earliest)
    .order("observed_at", { ascending: false })
    .limit(1000);

  if (error) throw error;

  const latestByStore = new Map<string, PriceRow>();
  for (const row of (data ?? []) as PriceRow[]) {
    const identity = canonicalStoreIdentity(row.store_code, row.store_name);
    if (!activeStoreKeys.has(identity.store_code)) continue;
    if (latestByStore.has(identity.store_code)) continue;
    latestByStore.set(identity.store_code, row);
  }

  return stores.map((store) => {
    const row = latestByStore.get(store.storeKey);
    return {
      storeKey: store.storeKey,
      storeName: store.storeName,
      price: row ? toNumber(row.price) : null,
      unitPrice: row ? toNumber(row.unit_price) : null,
      observedAt: row?.observed_at ?? null,
      source: displaySource(row?.source ?? null),
      isFresh: isFreshDate(row?.observed_at ?? null)
    } satisfies DisplayPrice;
  });
}

function pricesFromKassalapp(product: KassalappProduct, related: KassalappProduct[], stores: Awaited<ReturnType<typeof loadActiveStores>>) {
  const activeStoreKeys = new Set(stores.map((store) => store.storeKey));
  const latestByStore = new Map<string, KassalappProduct>();

  for (const candidate of priceProductsForProduct(product, related)) {
    const identity = canonicalStoreIdentity(candidate.store?.code, candidate.store?.name);
    if (!activeStoreKeys.has(identity.store_code)) continue;
    const observedAt = latestPriceDate(candidate);
    if (!isFreshDate(observedAt)) continue;
    if (!latestByStore.has(identity.store_code)) latestByStore.set(identity.store_code, candidate);
  }

  return stores.map((store) => {
    const candidate = latestByStore.get(store.storeKey);
    return {
      storeKey: store.storeKey,
      storeName: store.storeName,
      price: candidate?.current_price ?? null,
      unitPrice: candidate?.current_unit_price ?? null,
      observedAt: latestPriceDate(candidate ?? {} as KassalappProduct),
      source: candidate ? "Kassalapp API" : null,
      isFresh: isFreshDate(latestPriceDate(candidate ?? {} as KassalappProduct))
    } satisfies DisplayPrice;
  });
}

async function kassalappLookup(ean: string) {
  const lookup = await lookupKassalappProductsWithPricesByEan(ean);
  if (!lookup?.selected) return null;
  return lookup;
}

function productSummary(product: ProductRow | KassalappProduct | null, ean: string, source: "local" | "kassalapp" | "none") {
  if (!product) return null;
  return {
    id: "id" in product ? String(product.id) : null,
    name: product.name,
    brand: product.brand ?? null,
    ean: cleanEan(product.ean) || ean,
    imageUrl: "image_url" in product ? product.image_url ?? null : product.image ?? null,
    packageSize: "package_size" in product ? product.package_size ?? null : packageSize(product),
    category: "category" in product && typeof product.category === "string" ? product.category : source === "kassalapp" ? normalizeCategory(product as KassalappProduct) : null,
    source
  };
}
function firstGroupProduct(value: ProductGroupProductRow | ProductGroupProductRow[] | null | undefined) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function recomputeGroupUnitPrice(price: number | null, product: ProductGroupProductRow | null, comparisonUnit: string | null) {
  if (price === null || !product || !comparisonUnit) return null;
  const inferred = unitPricingColumnsForProduct(
    {
      name: product.name,
      brand: product.brand,
      category: product.category,
      package_size: product.package_size,
      comparison_unit: comparisonUnit
    },
    price
  );

  if (inferred.comparison_unit !== comparisonUnit || inferred.unit_price === null) return null;
  return inferred.unit_price;
}

function chooseGroupUnitPrice(storedUnitPrice: number | null, recomputedUnitPrice: number | null) {
  if (storedUnitPrice !== null && recomputedUnitPrice !== null) {
    const diffRatio = Math.abs(storedUnitPrice - recomputedUnitPrice) / Math.max(recomputedUnitPrice, 0.01);
    if (diffRatio > 0.30) return { unitPrice: recomputedUnitPrice, wasCorrected: true };
    return { unitPrice: storedUnitPrice, wasCorrected: false };
  }

  if (recomputedUnitPrice !== null) return { unitPrice: recomputedUnitPrice, wasCorrected: false };
  return { unitPrice: storedUnitPrice, wasCorrected: false };
}

async function loadProductGroupSummary(productId: string, stores: Awaited<ReturnType<typeof loadActiveStores>>): Promise<QuickProductGroup | null> {
  const supabase = getSupabaseAdmin();
  const activeStoreKeys = new Set(stores.map((store) => store.storeKey));

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

  const { data: observations, error: observationsError } = await supabase
    .from("price_observations")
    .select("id, product_id, store_code, store_name, price, unit_price, comparison_unit, package_quantity, package_unit, unit_price_source, observed_at, source")
    .in("product_id", productIds)
    .not("price", "is", null)
    .order("observed_at", { ascending: false })
    .limit(500);

  if (observationsError) throw observationsError;

  const latestByProductAndStore = new Map<string, PriceRow>();
  for (const observation of (observations ?? []) as PriceRow[]) {
    const identity = canonicalStoreIdentity(observation.store_code, observation.store_name);
    if (activeStoreKeys.size > 0 && !activeStoreKeys.has(identity.store_code)) continue;
    const key = `${observation.product_id}:${identity.store_code}`;
    if (!latestByProductAndStore.has(key)) latestByProductAndStore.set(key, observation);
  }

  const prices = [...latestByProductAndStore.values()]
    .map((observation) => {
      const memberProduct = productMap.get(String(observation.product_id)) ?? null;
      const identity = canonicalStoreIdentity(observation.store_code, observation.store_name);
      const price = toNumber(observation.price);
      const storedUnitPrice = toNumber(observation.unit_price);
      const comparisonUnit = observation.comparison_unit ?? group.comparison_unit ?? null;
      const recomputedUnitPrice = recomputeGroupUnitPrice(price, memberProduct, comparisonUnit);
      const chosen = chooseGroupUnitPrice(storedUnitPrice, recomputedUnitPrice);

      return {
        productId: String(observation.product_id),
        productName: memberProduct?.name ?? "Ukjent forpakning",
        brand: memberProduct?.brand ?? null,
        ean: memberProduct?.ean ?? null,
        packageSize: memberProduct?.package_size ?? null,
        storeKey: identity.store_code,
        storeName: identity.store_name,
        price,
        unitPrice: chosen.unitPrice,
        storedUnitPrice,
        unitPriceWasCorrected: chosen.wasCorrected,
        comparisonUnit,
        observedAt: observation.observed_at,
        source: displaySource(observation.source),
        ageDays: priceAgeDays(observation.observed_at),
        isFresh: isFreshGroupPrice(observation.observed_at),
        isStale: isStaleGroupPrice(observation.observed_at)
      } satisfies QuickGroupPrice;
    })
    .filter((price) => price.price !== null && price.unitPrice !== null && isUsableGroupPrice(price.observedAt))
    .sort((a, b) => {
      const aFreshness = groupPriceFreshnessRank(a.observedAt);
      const bFreshness = groupPriceFreshnessRank(b.observedAt);
      if (aFreshness !== bFreshness) return aFreshness - bFreshness;
      const aUnit = a.unitPrice ?? Number.POSITIVE_INFINITY;
      const bUnit = b.unitPrice ?? Number.POSITIVE_INFINITY;
      if (aUnit !== bUnit) return aUnit - bUnit;
      const aObserved = a.observedAt ? Date.parse(a.observedAt) : 0;
      const bObserved = b.observedAt ? Date.parse(b.observedAt) : 0;
      return bObserved - aObserved;
    });

  return {
    id: group.id,
    name: group.name,
    comparisonUnit: group.comparison_unit,
    packageCount: productIds.length,
    scannedPackage: prices.find((price) => price.productId === productId) ?? null,
    cheapest: prices[0] ?? null,
    priceOptions: prices
  };
}


async function lookupProduct(ean: string, householdId: string) {
  const stores = await loadActiveStores(householdId);
  const supabase = getSupabaseAdmin();
  const existingProduct = await findCanonicalProductByEan<ProductRow>(supabase, ean, PRODUCT_IDENTITY_SELECT);

  if (existingProduct) {
    const householdProduct = await loadHouseholdProduct(householdId, existingProduct.id);
    const prices = await pricesFromDatabase(existingProduct.id, stores);
    const productGroup = await loadProductGroupSummary(existingProduct.id, stores);
    return {
      ean,
      product: productSummary(existingProduct, ean, "local"),
      existsLocally: true,
      isBasis: Boolean(householdProduct?.is_basis),
      prices,
      productGroup,
      kassalappMessage: null as string | null
    };
  }

  try {
    const lookup = await kassalappLookup(ean);
    if (!lookup?.selected) {
      return {
        ean,
        product: null,
        existsLocally: false,
        isBasis: false,
        prices: emptyStorePrices(stores),
        kassalappMessage: "Fant ikke varen lokalt eller hos Kassalapp."
      };
    }

    return {
      ean,
      product: productSummary(lookup.selected, ean, "kassalapp"),
      existsLocally: false,
      isBasis: false,
      prices: pricesFromKassalapp(lookup.selected, lookup.related, stores),
      kassalappMessage: null as string | null
    };
  } catch (error) {
    return {
      ean,
      product: null,
      existsLocally: false,
      isBasis: false,
      prices: emptyStorePrices(stores),
      kassalappMessage: error instanceof Error ? error.message : "Kunne ikke hente varen fra Kassalapp."
    };
  }
}

async function findOrCreateProductForSave(ean: string, householdId: string, saveMode: SaveMode) {
  const supabase = getSupabaseAdmin();
  const existingProduct = await findCanonicalProductByEan<ProductRow>(supabase, ean, PRODUCT_IDENTITY_SELECT);

  if (existingProduct) {
    if (saveMode === "basis") await ensureHouseholdProduct(householdId, existingProduct);
    return existingProduct;
  }

  if (saveMode === "none") return null;

  const lookup = await kassalappLookup(ean);
  if (!lookup?.selected) return null;

  const inserted = await insertProductWithoutDuplicate<ProductRow>(
    supabase,
    productPayload(lookup.selected, ean),
    PRODUCT_IDENTITY_SELECT
  );

  if (saveMode === "basis") await ensureHouseholdProduct(householdId, inserted.data);
  return inserted.data;
}

async function getActiveStore(householdId: string, requestedStoreKey: unknown) {
  const storeKey = normalizeStoreCode(requestedStoreKey);
  const stores = await loadActiveStores(householdId);
  return stores.find((store) => store.storeKey === storeKey) ?? null;
}

export async function GET(request: Request) {
  try {
    const { householdId } = await requireCurrentHousehold(request);
    const { searchParams } = new URL(request.url);
    const ean = cleanEan(searchParams.get("ean"));

    if (ean.length < 6) {
      return NextResponse.json({ error: "Ugyldig EAN" }, { status: 400 });
    }

    const data = await lookupProduct(ean, householdId);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("[api/mobile/quick-price] GET", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireCurrentHousehold(request);
    const body = (await request.json()) as QuickPriceRequest;
    const ean = cleanEan(body.ean);
    const price = toNumber(body.price);
    const saveMode: SaveMode = body.saveMode === "basis" || body.saveMode === "global" ? body.saveMode : "none";
    const store = await getActiveStore(householdId, body.storeKey);

    if (ean.length < 6) {
      return NextResponse.json({ error: "Ugyldig EAN" }, { status: 400 });
    }

    if (!store) {
      return NextResponse.json({ error: "Velg en aktiv butikk før du lagrer pris." }, { status: 400 });
    }

    if (price === null || price <= 0 || price > 5000) {
      return NextResponse.json({ error: "Skriv en gyldig pris." }, { status: 400 });
    }

    const product = await findOrCreateProductForSave(ean, householdId, saveMode);
    if (!product) {
      return NextResponse.json({ error: "Varen må lagres globalt eller i basisutvalg før pris kan lagres." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const observedAt = new Date().toISOString();
    const unitPricing = unitPricingColumnsForProduct(product, price);
    const { error } = await supabase.from("price_observations").insert({
      product_id: product.id,
      household_id: householdId,
      observed_by_household_id: householdId,
      scope: "global",
      visibility: "public",
      store_code: store.storeKey,
      store_name: store.storeName,
      price,
      unit_price: unitPricing.unit_price,
      comparison_unit: unitPricing.comparison_unit,
      package_quantity: unitPricing.package_quantity,
      package_unit: unitPricing.package_unit,
      unit_price_source: unitPricing.unit_price_source,
      observed_at: observedAt,
      source: "manual",
      source_url: null,
      raw: {
        ean,
        saved_from: "mobile-quick-price",
        save_mode: saveMode,
        captured_at: observedAt,
        unit_pricing: unitPricing.raw_unit_pricing
      }
    });

    if (error) throw error;

    const data = await lookupProduct(ean, householdId);
    return NextResponse.json({ data: { ...data, savedPrice: { price, storeKey: store.storeKey, storeName: store.storeName, observedAt } } });
  } catch (error) {
    console.error("[api/mobile/quick-price] POST", error);
    return apiErrorResponse(error);
  }
}
