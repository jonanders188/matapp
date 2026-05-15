import { latestPriceDate, type KassalappProduct } from "@/lib/kassalapp";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type PriceObservationInput = {
  product_id: string;
  store_code: string;
  store_name: string;
  price: number;
  unit_price: number | null;
  observed_at: string;
  source: string;
  source_url: string | null;
  raw: KassalappProduct;
};

const STORE_NAMES: Record<string, string> = {
  kiwi: "KIWI",
  rema_1000: "REMA 1000",
  meny_no: "Meny",
  coop_no: "Coop",
  oda_no: "Oda",
  spar_no: "SPAR",
  joker_no: "Joker",
  europris_no: "Europris",
  bunnpris: "Bunnpris",
  engrossnett_no: "Engrosnett"
};

const STORE_ALIASES: Record<string, string> = {
  kiwi: "kiwi",
  rema: "rema_1000",
  rema1000: "rema_1000",
  rema_1000: "rema_1000",
  "rema-1000": "rema_1000",
  meny: "meny_no",
  meny_no: "meny_no",
  coop: "coop_no",
  coop_no: "coop_no",
  oda: "oda_no",
  oda_no: "oda_no",
  spar: "spar_no",
  spar_no: "spar_no",
  joker: "joker_no",
  joker_no: "joker_no",
  europris: "europris_no",
  europris_no: "europris_no",
  bunnpris: "bunnpris",
  engrosnett: "engrossnett_no",
  engrossnett: "engrossnett_no",
  engrossnett_no: "engrossnett_no"
};

export function normalizeStoreCode(value: unknown) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (!raw) return "";

  const compact = raw.replace(/[^a-z0-9]+/g, "");
  return STORE_ALIASES[raw] ?? STORE_ALIASES[compact] ?? raw;
}

export function canonicalStoreName(storeCode: unknown, fallback: unknown) {
  const normalized = normalizeStoreCode(storeCode || fallback);
  const fallbackName = String(fallback ?? storeCode ?? "Ukjent butikk").trim();
  return STORE_NAMES[normalized] ?? fallbackName;
}

export function canonicalStoreIdentity(storeCode: unknown, storeName: unknown) {
  const code = normalizeStoreCode(storeCode || storeName);
  return {
    store_code: code,
    store_name: canonicalStoreName(code, storeName || storeCode)
  };
}

function candidateKey(product: KassalappProduct) {
  return normalizeStoreCode(product.store?.code || product.store?.name || "unknown");
}

function observedAt(product: KassalappProduct) {
  return latestPriceDate(product) ?? new Date().toISOString();
}

function isSameProduct(a: KassalappProduct, b: KassalappProduct) {
  if (a.ean && b.ean) return a.ean === b.ean;
  if (a.id && b.id) return a.id === b.id;
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

function chooseBetterObservation(a: KassalappProduct, b: KassalappProduct) {
  const aDate = Date.parse(observedAt(a));
  const bDate = Date.parse(observedAt(b));

  if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) {
    return bDate > aDate ? b : a;
  }

  return Number(b.current_price ?? Number.POSITIVE_INFINITY) < Number(a.current_price ?? Number.POSITIVE_INFINITY)
    ? b
    : a;
}

export function priceProductsForProduct(product: KassalappProduct, relatedProducts: KassalappProduct[] = []) {
  const candidates = [product, ...relatedProducts]
    .filter((candidate) => candidate.store)
    .filter((candidate) => candidate.current_price != null)
    .filter((candidate) => isSameProduct(product, candidate));

  const byStore = new Map<string, KassalappProduct>();

  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (!key) continue;
    const existing = byStore.get(key);
    byStore.set(key, existing ? chooseBetterObservation(existing, candidate) : candidate);
  }

  return [...byStore.values()].sort((a, b) => {
    const aStore = a.store?.name ?? "";
    const bStore = b.store?.name ?? "";
    return aStore.localeCompare(bStore, "nb");
  });
}

export function priceObservationRows(
  productId: string,
  product: KassalappProduct,
  relatedProducts: KassalappProduct[] = [],
  source = "kassalapp"
): PriceObservationInput[] {
  return priceProductsForProduct(product, relatedProducts).map((candidate) => ({
    product_id: productId,
    store_code: normalizeStoreCode(candidate.store!.code || candidate.store!.name),
    store_name: canonicalStoreName(candidate.store!.code || candidate.store!.name, candidate.store!.name),
    price: candidate.current_price!,
    unit_price: candidate.current_unit_price ?? null,
    observed_at: observedAt(candidate),
    source,
    source_url: candidate.url ?? null,
    raw: candidate
  }));
}

export async function insertPriceObservations(
  productId: string,
  product: KassalappProduct,
  relatedProducts: KassalappProduct[] = [],
  source = "kassalapp"
) {
  const rows = priceObservationRows(productId, product, relatedProducts, source);
  if (!rows.length) return { inserted: 0, error: null as string | null };

  const supabase = getSupabaseAdmin();
  const storeCodes = [...new Set(rows.map((row) => row.store_code))];
  const observedDates = [...new Set(rows.map((row) => row.observed_at))];

  const { data: existing, error: existingError } = await supabase
    .from("price_observations")
    .select("store_code, price, observed_at, source")
    .eq("product_id", productId)
    .in("store_code", storeCodes)
    .in("observed_at", observedDates);

  if (existingError) {
    return { inserted: 0, error: existingError.message };
  }

  const existingKeys = new Set(
    (existing ?? []).map((row) => [
      normalizeStoreCode(row.store_code),
      Number(row.price),
      row.observed_at,
      row.source ?? ""
    ].join("|"))
  );

  const newRows = rows.filter((row) => !existingKeys.has([
    normalizeStoreCode(row.store_code),
    Number(row.price),
    row.observed_at,
    row.source
  ].join("|")));

  if (!newRows.length) return { inserted: 0, error: null as string | null };

  const { error } = await supabase.from("price_observations").insert(newRows);

  if (error) {
    return { inserted: 0, error: error.message };
  }

  return { inserted: newRows.length, error: null as string | null };
}
