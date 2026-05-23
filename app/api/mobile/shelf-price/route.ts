import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import {
  findKassalappProductsByEan,
  normalizeCategory,
  packageSize,
  productMetadataPayload,
  type KassalappProduct
} from "@/lib/kassalapp";
import { canonicalStoreIdentity, normalizeStoreCode as normalizeKnownStoreCode } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { findCanonicalProductByEan, insertProductWithoutDuplicate, PRODUCT_IDENTITY_SELECT } from "@/lib/product-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShelfPriceRequest = {
  ean?: string;
  price?: number;
  storeKey?: string;
  storeName?: string;
  rawText?: string;
};

function cleanEan(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").trim();
}

function toPrice(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function newestCandidate(candidates: KassalappProduct[]) {
  return [...candidates].sort((a, b) => Number(b.current_price ?? 0) - Number(a.current_price ?? 0))[0] ?? null;
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

type ShelfProductRow = {
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

type HouseholdProductSettings = {
  desired_stock?: number | null;
  target_price?: number | null;
  target_price_unit?: string | null;
  preferred_store?: string | null;
  is_freezable?: boolean | null;
  notes?: string | null;
};

function mergeHouseholdProduct(product: ShelfProductRow, householdProduct: HouseholdProductSettings | null | undefined) {
  return {
    ...product,
    is_basis: Boolean(householdProduct),
    desired_stock: householdProduct?.desired_stock ?? 1,
    target_price: householdProduct?.target_price ?? null,
    target_price_unit: householdProduct?.target_price_unit ?? "unit",
    preferred_store: householdProduct?.preferred_store ?? null,
    is_freezable: householdProduct?.is_freezable ?? false,
    notes: householdProduct?.notes ?? product.notes ?? null
  };
}

async function ensureHouseholdProduct(
  householdId: string,
  productId: string,
  settings: HouseholdProductSettings = {}
) {
  const supabase = getSupabaseAdmin();
  const payload = {
    household_id: householdId,
    product_id: productId,
    is_basis: true,
    desired_stock: settings.desired_stock ?? 1,
    target_price: settings.target_price ?? null,
    target_price_unit: settings.target_price_unit ?? "unit",
    preferred_store: settings.preferred_store ?? null,
    is_freezable: settings.is_freezable ?? false,
    notes: settings.notes ?? null,
    updated_at: new Date().toISOString()
  };

  const existing = await supabase
    .from("household_products")
    .select("id, is_basis, desired_stock, target_price, target_price_unit, preferred_store, is_freezable, notes")
    .eq("household_id", householdId)
    .eq("product_id", productId)
    .limit(1);

  if (existing.error) throw existing.error;

  const existingRow = existing.data?.[0] ?? null;
  const result = existingRow
    ? await supabase.from("household_products").update(payload).eq("id", existingRow.id).select("*").single()
    : await supabase.from("household_products").insert(payload).select("*").single();

  if (result.error) throw result.error;
  return result.data;
}

function normalizeStoreKey(value: unknown) {
  return normalizeKnownStoreCode(value);
}

async function getSavedStore(householdId: string, storeKey: string) {
  const normalizedStoreKey = normalizeStoreKey(storeKey);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("household_store_preferences")
    .select("store_key, store_name, is_enabled, priority")
    .eq("household_id", householdId)
    .eq("store_key", normalizedStoreKey)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function findOrCreateProduct(householdId: string, ean: string) {
  const supabase = getSupabaseAdmin();

  const existingProduct = await findCanonicalProductByEan<ShelfProductRow>(supabase, ean, PRODUCT_IDENTITY_SELECT);

  if (existingProduct) {
    const householdProduct = await ensureHouseholdProduct(householdId, existingProduct.id);
    return { product: mergeHouseholdProduct(existingProduct, householdProduct), created: false };
  }

  const candidates = await findKassalappProductsByEan(ean);
  const selected = newestCandidate(candidates);

  if (!selected?.id || !selected.name) {
    return { product: null, created: false };
  }

  const saved = await insertProductWithoutDuplicate<ShelfProductRow>(
    supabase,
    productPayload(selected, ean),
    PRODUCT_IDENTITY_SELECT
  );

  const householdProduct = await ensureHouseholdProduct(householdId, saved.data.id);
  return { product: mergeHouseholdProduct(saved.data, householdProduct), created: !saved.reusedExisting };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ShelfPriceRequest;
    const ean = cleanEan(body.ean);
    const price = toPrice(body.price);
    const storeKey = normalizeStoreKey(body.storeKey);

    if (ean.length < 6) {
      return NextResponse.json({ error: "Ugyldig EAN fra hyllekant" }, { status: 400 });
    }

    if (price === null || price <= 0) {
      return NextResponse.json({ error: "Ugyldig pris fra hyllekant" }, { status: 400 });
    }

    if (!storeKey) {
      return NextResponse.json({ error: "Velg en lagret butikk før hyllepris lagres" }, { status: 400 });
    }

    const { householdId } = await requireCurrentHousehold(request);
    const store = await getSavedStore(householdId, storeKey);

    if (!store?.store_key || !store?.store_name) {
      return NextResponse.json({ error: "Butikken finnes ikke i lagrede butikkpreferanser" }, { status: 400 });
    }

    const productResult = await findOrCreateProduct(householdId, ean);

    if (!productResult.product) {
      return NextResponse.json(
        {
          error: "Fant ikke produktet",
          ean,
          message: "Produktet ble ikke funnet lokalt eller hos Kassalapp. Lag produktet først, og prøv igjen."
        },
        { status: 404 }
      );
    }

    const supabase = getSupabaseAdmin();
    const storeIdentity = canonicalStoreIdentity(store.store_key, store.store_name);
    const { error } = await supabase.from("price_observations").insert({
      product_id: productResult.product.id,
      household_id: householdId,
      observed_by_household_id: householdId,
      scope: "global",
      visibility: "public",
      store_code: storeIdentity.store_code,
      store_name: storeIdentity.store_name,
      price,
      unit_price: null,
      observed_at: new Date().toISOString(),
      source: "shelf-edge",
      source_url: null,
      raw: {
        ean,
        raw_text: body.rawText ?? null,
        captured_at: new Date().toISOString(),
        requested_store_key: body.storeKey ?? null,
        requested_store_name: body.storeName ?? null
      }
    });

    if (error) throw error;

    return NextResponse.json({
      data: {
        ean,
        price,
        storeKey: storeIdentity.store_code,
        storeName: storeIdentity.store_name,
        product: productResult.product,
        createdProduct: productResult.created
      }
    });
  } catch (error) {
    console.error("[api/mobile/shelf-price]", error);
    return apiErrorResponse(error);
  }
}
