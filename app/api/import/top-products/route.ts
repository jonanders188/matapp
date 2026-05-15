import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-guard";
import { TOP_50_PRODUCTS, type TopProductSeed } from "@/lib/top-products";
import { normalizeCategory, packageSize, productMetadataPayload, searchKassalappProducts, type KassalappProduct } from "@/lib/kassalapp";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { canonicalStoreName, normalizeStoreCode } from "@/lib/price-observations";
import { normalizeProductEan } from "@/lib/product-identity";

type ImportBody = {
  dryRun?: boolean;
  limit?: number;
  products?: string[];
};

function cleanName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9æøå]+/gi, " ").trim();
}

function scoreMatch(seed: TopProductSeed, product: KassalappProduct) {
  if (seed.ean && product.ean === seed.ean) return 10_000;

  const haystack = cleanName(`${product.name} ${product.brand ?? ""} ${packageSize(product) ?? ""}`);
  const needles = cleanName(seed.search).split(" ").filter((word) => word.length > 2);
  const matchedWords = needles.filter((word) => haystack.includes(word)).length;

  let score = matchedWords * 10;
  if (product.current_price != null) score += 3;
  if (product.store?.name) score += 1;
  if (product.image) score += 1;
  return score;
}

function chooseBestMatch(seed: TopProductSeed, matches: KassalappProduct[]) {
  const relevant = seed.ean ? matches.filter((match) => match.ean === seed.ean) : matches;
  const candidates = relevant.length ? relevant : matches;
  return [...candidates].sort((a, b) => scoreMatch(seed, b) - scoreMatch(seed, a))[0] ?? null;
}

function priceMatchesForSeed(seed: TopProductSeed, matches: KassalappProduct[], chosen: KassalappProduct | null) {
  if (seed.ean) return matches.filter((match) => match.ean === seed.ean && match.store && match.current_price != null);
  if (!chosen?.name) return [];
  const chosenName = cleanName(chosen.name);
  return matches
    .filter((match) => match.store && match.current_price != null)
    .filter((match) => match.ean && chosen.ean ? match.ean === chosen.ean : cleanName(match.name) === chosenName)
    .slice(0, 8);
}

function productPayload(seed: TopProductSeed, product: KassalappProduct, householdId: string) {
  return {
    household_id: householdId,
    kassalapp_id: product.id,
    ean: normalizeProductEan(product.ean ?? seed.ean),
    name: product.name,
    brand: product.brand ?? null,
    category: normalizeCategory(product) ?? seed.category,
    package_size: packageSize(product),
    image_url: product.image ?? null,
    target_price: seed.targetPrice ?? product.current_price ?? null,
    target_price_unit: product.current_unit_price ? "unit_price" : "unit",
    desired_stock: seed.desiredStock,
    is_basis: seed.isBasis ?? false,
    is_freezable: seed.isFreezable ?? false,
    preferred_store: seed.preferredStore ?? product.store?.name ?? null,
    notes: [seed.notes, product.url].filter(Boolean).join("\n") || null,
    ...productMetadataPayload(product)
  };
}

async function ensureHousehold() {
  const supabase = getSupabaseAdmin();
  const name = process.env.DEFAULT_HOUSEHOLD_NAME ?? "Familien";

  const existing = await supabase
    .from("households")
    .select("id, name")
    .eq("name", name)
    .order("created_at", { ascending: true })
    .limit(1);

  if (existing.error) throw existing.error;
  if (existing.data?.[0]) return existing.data[0];

  const created = await supabase
    .from("households")
    .insert({ name, monthly_budget: 0 })
    .select("id, name")
    .limit(1);

  if (created.error) throw created.error;
  if (!created.data?.[0]) throw new Error("Kunne ikke opprette household");
  return created.data[0];
}

async function findExistingProduct(_householdId: string, seed: TopProductSeed, product: KassalappProduct) {
  const supabase = getSupabaseAdmin();

  const normalizedEan = normalizeProductEan(product.ean ?? seed.ean);

  if (normalizedEan) {
    const byEan = await supabase
      .from("products")
      .select("id")
      .eq("ean", normalizedEan)
      .order("created_at", { ascending: true })
      .limit(1);
    if (byEan.error) throw byEan.error;
    if (byEan.data?.[0]) return byEan.data[0];
  }

  const byKassalappId = await supabase
    .from("products")
    .select("id")
    .eq("kassalapp_id", product.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (byKassalappId.error) throw byKassalappId.error;
  return byKassalappId.data?.[0] ?? null;
}

async function upsertInventory(householdId: string, productId: string, seed: TopProductSeed) {
  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from("inventory_items")
    .select("id")
    .eq("household_id", householdId)
    .eq("product_id", productId)
    .eq("location", seed.location)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (existing.error) throw existing.error;

  if (existing.data?.[0]) {
    const updated = await supabase
      .from("inventory_items")
      .update({ desired_quantity: seed.desiredStock, updated_at: new Date().toISOString() })
      .eq("id", existing.data[0].id);
    if (updated.error) throw updated.error;
    return;
  }

  const inserted = await supabase.from("inventory_items").insert({
    household_id: householdId,
    product_id: productId,
    location: seed.location,
    quantity: 0,
    desired_quantity: seed.desiredStock
  });
  if (inserted.error) throw inserted.error;
}

async function insertPriceObservations(productId: string, matches: KassalappProduct[]) {
  const supabase = getSupabaseAdmin();
  const rows = matches
    .filter((match) => match.store && match.current_price != null)
    .map((match) => ({
      product_id: productId,
      store_code: normalizeStoreCode(match.store!.code || match.store!.name),
      store_name: canonicalStoreName(match.store!.code || match.store!.name, match.store!.name),
      price: match.current_price!,
      unit_price: match.current_unit_price ?? null,
      observed_at: match.price_history?.[0]?.date ?? new Date().toISOString(),
      source: "kassalapp-import",
      source_url: match.url ?? null,
      raw: match
    }));

  if (!rows.length) return 0;
  const inserted = await supabase.from("price_observations").insert(rows);
  if (inserted.error) throw inserted.error;
  return rows.length;
}

async function importOne(seed: TopProductSeed, householdId: string, dryRun: boolean) {
  const matches = await searchKassalappProducts(seed.ean ?? seed.search, 20);
  const chosen = chooseBestMatch(seed, matches);

  if (!chosen) {
    return { key: seed.key, search: seed.search, status: "not_found" as const, matches: 0 };
  }

  const priceMatches = priceMatchesForSeed(seed, matches, chosen);

  if (dryRun) {
    return {
      key: seed.key,
      search: seed.search,
      status: "dry_run" as const,
      chosen: { id: chosen.id, name: chosen.name, ean: chosen.ean, price: chosen.current_price, store: chosen.store?.name },
      priceObservations: priceMatches.length
    };
  }

  const supabase = getSupabaseAdmin();
  const existing = await findExistingProduct(householdId, seed, chosen);
  const payload = productPayload(seed, chosen, householdId);

  let saved = existing
    ? await supabase.from("products").update(payload).eq("id", existing.id).select("id, name").limit(1)
    : await supabase.from("products").insert(payload).select("id, name").limit(1);

  if (saved.error && (saved.error as { code?: string }).code === "23505" && payload.ean) {
    saved = await supabase
      .from("products")
      .select("id, name")
      .eq("ean", payload.ean)
      .order("created_at", { ascending: true })
      .limit(1);
  }

  if (saved.error) throw saved.error;
  const savedProduct = saved.data?.[0];
  if (!savedProduct) throw new Error(`Kunne ikke lagre ${seed.key}`);

  const warnings: string[] = [];
  try {
    await upsertInventory(householdId, savedProduct.id, seed);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Kunne ikke oppdatere lager");
  }

  let insertedPrices = 0;
  try {
    insertedPrices = await insertPriceObservations(savedProduct.id, priceMatches.length ? priceMatches : [chosen]);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Kunne ikke lagre prisobservasjoner");
  }

  return {
    key: seed.key,
    search: seed.search,
    status: existing ? "updated" as const : "created" as const,
    productId: savedProduct.id,
    name: savedProduct.name,
    ean: chosen.ean,
    priceObservations: insertedPrices,
    warnings
  };
}

export async function GET() {
  return NextResponse.json({
    count: TOP_50_PRODUCTS.length,
    products: TOP_50_PRODUCTS.map(({ key, search, ean, category, targetPrice, desiredStock, location }) => ({
      key,
      search,
      ean,
      category,
      targetPrice,
      desiredStock,
      location
    })),
    run: "POST /api/import/top-products med { dryRun: true } først, deretter { dryRun: false }."
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as ImportBody;
    const dryRun = body.dryRun ?? false;
    const limit = Math.min(Math.max(body.limit ?? TOP_50_PRODUCTS.length, 1), TOP_50_PRODUCTS.length);
    const selectedKeys = new Set(body.products ?? []);
    const seeds = TOP_50_PRODUCTS
      .filter((seed) => !selectedKeys.size || selectedKeys.has(seed.key))
      .slice(0, limit);

    const household = await ensureHousehold();
    const results = [];

    for (const seed of seeds) {
      try {
        results.push(await importOne(seed, household.id, dryRun));
      } catch (error) {
        results.push({
          key: seed.key,
          search: seed.search,
          status: "error" as const,
          error: error instanceof Error ? error.message : "Ukjent feil"
        });
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      household,
      requested: seeds.length,
      created: results.filter((result) => result.status === "created").length,
      updated: results.filter((result) => result.status === "updated").length,
      notFound: results.filter((result) => result.status === "not_found").length,
      errors: results.filter((result) => result.status === "error").length,
      results
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import feilet" },
      { status: 500 }
    );
  }
}
