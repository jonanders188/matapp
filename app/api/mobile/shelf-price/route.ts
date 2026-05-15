import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import {
  findKassalappProductsByEan,
  normalizeCategory,
  packageSize,
  type KassalappProduct
} from "@/lib/kassalapp";
import { getSupabaseAdmin } from "@/lib/supabase-server";

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

function productPayload(product: KassalappProduct, householdId: string, ean: string) {
  return {
    household_id: householdId,
    kassalapp_id: product.id,
    ean: cleanEan(product.ean) || ean,
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

async function getSavedStore(householdId: string, storeKey: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("household_store_preferences")
    .select("store_key, store_name, is_enabled, priority")
    .eq("household_id", householdId)
    .eq("store_key", storeKey)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function findOrCreateProduct(householdId: string, ean: string) {
  const supabase = getSupabaseAdmin();

  const existing = await supabase
    .from("products")
    .select("id, name, brand, ean, category, package_size, image_url, desired_stock, is_basis")
    .eq("household_id", householdId)
    .eq("ean", ean)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data) {
    if (existing.data.is_basis) return { product: existing.data, created: false };

    const updated = await supabase
      .from("products")
      .update({ is_basis: true })
      .eq("id", existing.data.id)
      .select("id, name, brand, ean, category, package_size, image_url, desired_stock, is_basis")
      .single();

    if (updated.error) throw updated.error;
    return { product: updated.data, created: false };
  }

  const candidates = await findKassalappProductsByEan(ean);
  const selected = newestCandidate(candidates);

  if (!selected?.id || !selected.name) {
    return { product: null, created: false };
  }

  const inserted = await supabase
    .from("products")
    .insert(productPayload(selected, householdId, ean))
    .select("id, name, brand, ean, category, package_size, image_url, desired_stock, is_basis")
    .single();

  if (inserted.error) throw inserted.error;
  return { product: inserted.data, created: true };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ShelfPriceRequest;
    const ean = cleanEan(body.ean);
    const price = toPrice(body.price);
    const storeKey = String(body.storeKey ?? "").trim();

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
    const { error } = await supabase.from("price_observations").insert({
      product_id: productResult.product.id,
      store_code: store.store_key,
      store_name: store.store_name,
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
        storeKey: store.store_key,
        storeName: store.store_name,
        product: productResult.product,
        createdProduct: productResult.created
      }
    });
  } catch (error) {
    console.error("[api/mobile/shelf-price]", error);
    return apiErrorResponse(error);
  }
}
