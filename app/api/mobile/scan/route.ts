import { NextResponse } from "next/server";
import { findKassalappProductsByEan, latestPriceDate, lookupKassalappProductsWithPricesByEan, normalizeCategory, packageSize, productMetadataPayload, searchKassalappProducts, type KassalappProduct } from "@/lib/kassalapp";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { canonicalStoreIdentity, insertPriceObservations } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { findCanonicalProductByEan, insertProductWithoutDuplicate, PRODUCT_IDENTITY_SELECT } from "@/lib/product-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ScanMode = "in" | "out";

type ReceiptLineInput = {
  id: string;
  text: string;
  price: number;
};

type ReceiptMatchInput = {
  storeKey?: string;
  storeName?: string;
  observedAt?: string;
  lines?: ReceiptLineInput[];
};

type ScanRequest = {
  ean?: string;
  mode?: ScanMode;
  receipt?: ReceiptMatchInput;
};

function normalizeEan(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").trim();
}

function productPayload(product: KassalappProduct) {
  return {
    kassalapp_id: product.id,
    ean: normalizeEan(product.ean) || null,
    name: product.name,
    brand: product.brand ?? null,
    category: normalizeCategory(product),
    package_size: packageSize(product),
    image_url: product.image ?? null,
    notes: product.url ?? null,
    ...productMetadataPayload(product)
  };
}

type MobileProductRow = {
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

function householdProductPayload(
  householdId: string,
  productId: string,
  settings: HouseholdProductSettings = {}
) {
  return {
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
}

function mergeHouseholdProduct(product: MobileProductRow, householdProduct: HouseholdProductSettings | null | undefined) {
  if (!householdProduct) return product;

  return {
    ...product,
    is_basis: true,
    desired_stock: householdProduct.desired_stock ?? product.desired_stock,
    target_price: householdProduct.target_price ?? product.target_price,
    target_price_unit: householdProduct.target_price_unit ?? product.target_price_unit,
    preferred_store: householdProduct.preferred_store ?? product.preferred_store,
    is_freezable: householdProduct.is_freezable ?? product.is_freezable,
    notes: householdProduct.notes ?? product.notes
  };
}

async function ensureHouseholdProduct(
  householdId: string,
  productId: string,
  settings: HouseholdProductSettings = {}
) {
  const supabase = getSupabaseAdmin();
  const payload = householdProductPayload(householdId, productId, settings);

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

  return {
    data: result.data,
    madeBasis: !existingRow || existingRow.is_basis === false
  };
}

function defaultLocation(product: { category?: string | null; name?: string | null }) {
  const text = `${product.category ?? ""} ${product.name ?? ""}`.toLowerCase();
  if (text.includes("melk") || text.includes("yoghurt") || text.includes("ost") || text.includes("kjøtt") || text.includes("fisk")) {
    return "Kjoleskap";
  }
  return "Kjokken";
}

function toNumber(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeReceiptText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replaceAll("æ", "a")
    .replace(/(?<=\d)[oO](?=\d|\s|$)/g, "0")
    .replace(/(?<=\d)[lI](?=\d|\s|$)/g, "1")
    .replace(/[^a-z0-9,.]+/g, " ")
    .trim();
}

function compactReceiptText(value: string) {
  return normalizeReceiptText(value).replace(/[^a-z0-9]/g, "");
}

function receiptTokens(value: string) {
  const stopWords = new Set(["og", "med", "uten", "pk", "stk", "ca", "fra", "the", "for", "vare", "pris", "kg", "g", "ml", "l"]);
  return normalizeReceiptText(value)
    .replace(/[,.]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function normalizeStoreCode(value: string) {
  return normalizeReceiptText(value).replace(/\s+/g, "_") || "receipt";
}

async function canonicalReceiptStore(householdId: string, receipt?: ReceiptMatchInput) {
  const requestedKey = String(receipt?.storeKey ?? "").trim().toLowerCase();
  const requestedName = String(receipt?.storeName ?? "").trim();
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("household_store_preferences")
    .select("store_key, store_name")
    .eq("household_id", householdId);

  if (error) throw error;

  const stores = data ?? [];

  if (requestedKey) {
    const keyMatch = stores.find((store) => String(store.store_key ?? "").trim().toLowerCase() === requestedKey);
    if (keyMatch?.store_key && keyMatch?.store_name) {
      return { storeKey: keyMatch.store_key, storeName: keyMatch.store_name };
    }
  }

  if (requestedName) {
    const requestedCode = normalizeStoreCode(requestedName);
    const nameMatch = stores.find((store) =>
      normalizeStoreCode(String(store.store_name ?? "")) === requestedCode ||
      normalizeStoreCode(String(store.store_key ?? "")) === requestedCode
    );

    if (nameMatch?.store_key && nameMatch?.store_name) {
      return { storeKey: nameMatch.store_key, storeName: nameMatch.store_name };
    }
  }

  return null;
}

function extractPackageTokens(value?: string | null) {
  if (!value) return [];

  const normalized = normalizeReceiptText(value).replace(/,/g, ".");
  const compact = normalized.replace(/\s+/g, "");
  const tokens = new Set<string>();

  for (const match of compact.matchAll(/\d+(?:\.\d+)?(?:kg|g|l|ml|stk|pk)/g)) {
    tokens.add(match[0]);
  }

  for (const match of normalized.matchAll(/(\d+)\s*(?:x|pk|stk)\s*(\d+(?:\.\d+)?)(kg|g|l|ml)/g)) {
    tokens.add(`${match[1]}x${match[2]}${match[3]}`);
    tokens.add(`${match[2]}${match[3]}`);
  }

  return [...tokens];
}

function tokenCoverage(productTokens: string[], lineText: string) {
  if (!productTokens.length) return 0;
  const uniqueTokens = [...new Set(productTokens)];
  const matched = uniqueTokens.filter((token) => lineText.includes(token));
  return matched.length / uniqueTokens.length;
}

function scoreReceiptLine(product: { name?: string | null; brand?: string | null; package_size?: string | null }, line: ReceiptLineInput) {
  const lineText = normalizeReceiptText(line.text);
  const lineCompact = compactReceiptText(line.text);
  if (!lineText || !line.price || line.price <= 0) return 0;

  const nameTokens = receiptTokens(product.name ?? "");
  const brandTokens = receiptTokens(product.brand ?? "");
  const allProductTokens = receiptTokens(`${product.name ?? ""} ${product.brand ?? ""}`);
  if (!allProductTokens.length) return 0;

  let score = 0;

  for (const token of allProductTokens) {
    if (lineText.includes(token)) score += token.length >= 6 ? 14 : token.length >= 4 ? 10 : 6;
  }

  const nameCoverage = tokenCoverage(nameTokens, lineText);
  if (nameCoverage >= 0.75) score += 35;
  else if (nameCoverage >= 0.5) score += 22;
  else if (nameCoverage >= 0.34) score += 10;

  if (brandTokens.length && brandTokens.some((token) => lineText.includes(token))) score += 22;

  const productPackTokens = [...extractPackageTokens(product.package_size), ...extractPackageTokens(product.name)].filter(Boolean);
  const linePackTokens = extractPackageTokens(line.text);
  const packMatches = productPackTokens.filter((token) => lineCompact.includes(token.replace(/[^a-z0-9]/g, "")) || linePackTokens.includes(token));
  score += [...new Set(packMatches)].length * 35;

  const productCompact = compactReceiptText(`${product.name ?? ""} ${product.brand ?? ""}`);
  if (productCompact.length >= 8 && lineCompact.includes(productCompact.slice(0, Math.min(productCompact.length, 18)))) score += 18;

  if (lineText.includes("first price") && normalizeReceiptText(`${product.name ?? ""} ${product.brand ?? ""}`).includes("first price")) score += 18;
  if (lineText.includes("eldorado") && normalizeReceiptText(`${product.name ?? ""} ${product.brand ?? ""}`).includes("eldorado")) score += 18;
  if (lineText.includes("tine") && normalizeReceiptText(`${product.name ?? ""} ${product.brand ?? ""}`).includes("tine")) score += 18;

  return score;
}

async function insertReceiptPriceObservation(
  product: { id: string; name?: string | null; brand?: string | null; package_size?: string | null },
  ean: string,
  householdId: string,
  receipt?: ReceiptMatchInput
) {
  const usableLines = receipt?.lines?.filter((line) => line.id && line.text && Number.isFinite(Number(line.price))) ?? [];
  if (!usableLines.length) return null;

  const scoredLines = usableLines
    .map((line) => ({ line, score: scoreReceiptLine(product, line) }))
    .sort((a, b) => b.score - a.score);

  const best = scoredLines[0];
  const secondBest = scoredLines[1];

  if (!best || best.score < 55) return null;
  if (secondBest && best.score - secondBest.score < 12 && secondBest.score >= 45) return null;

  const store = await canonicalReceiptStore(householdId, receipt);
  if (!store) return null;

  const storeName = store.storeName;
  const storeIdentity = canonicalStoreIdentity(store.storeKey, storeName);
  const observedAt = receipt?.observedAt && Number.isFinite(Date.parse(receipt.observedAt)) ? receipt.observedAt : new Date().toISOString();
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("price_observations").insert({
    product_id: product.id,
    household_id: householdId,
    observed_by_household_id: householdId,
    scope: "global",
    visibility: "public",
    store_code: storeIdentity.store_code,
    store_name: storeIdentity.store_name,
    price: Number(best.line.price),
    unit_price: null,
    observed_at: observedAt,
    source: "receipt-scan",
    source_url: null,
    raw: {
      ean,
      line_id: best.line.id,
      line_text: best.line.text,
      score: best.score,
      captured_at: new Date().toISOString(),
      receipt_store_key: receipt?.storeKey ?? null,
      canonical_store_key: store.storeKey
    }
  });

  if (error) {
    console.warn("[api/mobile/scan] receipt price insert failed", error.message);
    return {
      lineId: best.line.id,
      lineText: best.line.text,
      price: Number(best.line.price),
      storeName,
      inserted: false
    };
  }

  return {
    lineId: best.line.id,
    lineText: best.line.text,
    price: Number(best.line.price),
    storeName,
    inserted: true
  };
}

function sameEanCandidates(ean: string, selected: KassalappProduct, candidates: KassalappProduct[]) {
  const selectedEan = normalizeEan(selected.ean) || ean;

  return candidates.filter((candidate) => normalizeEan(candidate.ean) === selectedEan);
}

function newestCandidate(candidates: KassalappProduct[]) {
  return [...candidates].sort((a, b) => {
    const aDate = Date.parse(latestPriceDate(a) ?? "");
    const bDate = Date.parse(latestPriceDate(b) ?? "");

    if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) {
      return bDate - aDate;
    }

    return Number(a.current_price ?? Number.POSITIVE_INFINITY) - Number(b.current_price ?? Number.POSITIVE_INFINITY);
  })[0];
}

async function fetchKassalappProductWithPrices(ean: string) {
  const eanMatches = await findKassalappProductsByEan(ean);
  const selectedFromEan = newestCandidate(eanMatches);

  if (selectedFromEan?.id && selectedFromEan.name) {
    return {
      selected: selectedFromEan,
      related: sameEanCandidates(ean, selectedFromEan, eanMatches)
    };
  }

  const candidates = await searchKassalappProducts(ean, 50);
  const exactMatches = candidates.filter((candidate) => normalizeEan(candidate.ean) === ean);
  const selected = newestCandidate(exactMatches) ?? newestCandidate(candidates);

  if (!selected?.id || !selected.name) {
    return { selected: null, related: [] as KassalappProduct[] };
  }

  return {
    selected,
    related: sameEanCandidates(ean, selected, candidates)
  };
}

async function refreshProductPrices(productId: string, ean: string) {
  const { selected, related } = await fetchKassalappProductWithPrices(ean);
  if (!selected) return { inserted: 0, found: false };

  const priceResult = await insertPriceObservations(productId, selected, related, "kassalapp-mobile-scan");
  return { inserted: priceResult.inserted, found: true };
}

async function findOrCreateProduct(ean: string, householdId: string, options?: { skipKassalappPriceInsert?: boolean }) {
  const supabase = getSupabaseAdmin();

  const existingProduct = await findCanonicalProductByEan<MobileProductRow>(supabase, ean, PRODUCT_IDENTITY_SELECT);

  if (existingProduct) {
    const householdProduct = await ensureHouseholdProduct(householdId, existingProduct.id, existingProduct);
    const priceResult = options?.skipKassalappPriceInsert ? { inserted: 0, found: false } : await refreshProductPrices(existingProduct.id, ean);

    return {
      product: mergeHouseholdProduct(existingProduct, householdProduct.data),
      created: false,
      madeBasis: householdProduct.madeBasis,
      priceObservationsInserted: priceResult.inserted
    };
  }

  const { selected, related } = await fetchKassalappProductWithPrices(ean);

  if (!selected) {
    return { product: null, created: false, madeBasis: false, priceObservationsInserted: 0 };
  }

  const payload = {
    ...productPayload(selected),
    ean: normalizeEan(selected.ean) || ean
  };

  const saved = await insertProductWithoutDuplicate<MobileProductRow>(supabase, payload, PRODUCT_IDENTITY_SELECT);

  const householdProduct = await ensureHouseholdProduct(householdId, saved.data.id, saved.data);
  const priceResult = options?.skipKassalappPriceInsert
    ? { inserted: 0 }
    : await insertPriceObservations(saved.data.id, selected, related, "kassalapp-mobile-scan");

  return {
    product: mergeHouseholdProduct(saved.data, householdProduct.data),
    created: !saved.reusedExisting,
    madeBasis: true,
    priceObservationsInserted: priceResult.inserted
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ScanRequest;
    const ean = normalizeEan(body.ean);
    const mode: ScanMode = body.mode === "out" ? "out" : "in";

    if (ean.length < 6) {
      return NextResponse.json({ error: "Ugyldig EAN / strekkode" }, { status: 400 });
    }

    const { householdId } = await requireCurrentHousehold(request);
    const supabase = getSupabaseAdmin();
    const hasReceiptBuffer = Boolean(body.receipt?.lines?.length);
    const productResult = await findOrCreateProduct(ean, householdId, {
      skipKassalappPriceInsert: hasReceiptBuffer
    });

    if (!productResult.product) {
      return NextResponse.json(
        {
          error: "Fant ikke produktet",
          ean,
          message: "Produktet finnes ikke i basisutvalget og ble ikke funnet hos Kassalapp."
        },
        { status: 404 }
      );
    }

    const product = productResult.product;
    const receiptPriceMatch = await insertReceiptPriceObservation(product, ean, householdId, body.receipt);

    const existingInventory = await supabase
      .from("inventory_items")
      .select("id, quantity, desired_quantity, location")
      .eq("household_id", householdId)
      .eq("product_id", product.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingInventory.error) throw existingInventory.error;

    const beforeQuantity = toNumber(existingInventory.data?.quantity, 0);
    const afterQuantity = mode === "in" ? beforeQuantity + 1 : Math.max(0, beforeQuantity - 1);
    const now = new Date().toISOString();

    if (existingInventory.data?.id) {
      const updated = await supabase
        .from("inventory_items")
        .update({ quantity: afterQuantity, updated_at: now })
        .eq("id", existingInventory.data.id)
        .select("id, quantity, desired_quantity, location, updated_at")
        .single();

      if (updated.error) throw updated.error;

      return NextResponse.json({
        data: {
          ean,
          mode,
          product,
          inventory: updated.data,
          beforeQuantity,
          afterQuantity,
          createdProduct: productResult.created,
          madeBasis: productResult.madeBasis,
          priceObservationsInserted: productResult.priceObservationsInserted,
          receiptPriceMatch
        }
      });
    }

    const created = await supabase
      .from("inventory_items")
      .insert({
        household_id: householdId,
        product_id: product.id,
        location: defaultLocation(product),
        quantity: afterQuantity,
        desired_quantity: toNumber(product.desired_stock, 1),
        updated_at: now
      })
      .select("id, quantity, desired_quantity, location, updated_at")
      .single();

    if (created.error) throw created.error;

    return NextResponse.json({
      data: {
        ean,
        mode,
        product,
        inventory: created.data,
        beforeQuantity,
        afterQuantity,
        createdProduct: productResult.created,
        madeBasis: productResult.madeBasis,
        priceObservationsInserted: productResult.priceObservationsInserted,
        receiptPriceMatch
      }
    });
  } catch (error) {
    console.error("[api/mobile/scan]", error);
    return apiErrorResponse(error);
  }
}
