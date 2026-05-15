import { ensureDefaultHousehold } from "@/lib/db";
import { alternativeRulesForProduct, productIsAlreadyPrivateLabel } from "@/lib/alternative-rules";
import { searchKassalappProducts, type KassalappProduct } from "@/lib/kassalapp";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ProductRow = {
  id: string;
  household_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  ean: string | null;
  created_at?: string | null;
};

type ObservationRow = {
  product_id: string;
  store_name: string;
  price: number;
  unit_price: number | null;
  observed_at: string;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function productNameScore(source: ProductRow, candidate: KassalappProduct) {
  const sourceText = source.name.toLowerCase();
  const candidateText = `${candidate.name} ${candidate.brand ?? ""}`.toLowerCase();
  let score = 0;

  for (const token of sourceText.split(/\s+/).filter((part) => part.length > 3)) {
    if (candidateText.includes(token)) score += 0.06;
  }

  return Math.min(score, 0.24);
}

function brandScore(candidate: KassalappProduct, preferredBrands?: string[]) {
  const candidateBrand = `${candidate.brand ?? ""} ${candidate.name}`.toLowerCase();
  if (!preferredBrands?.length) return 0;
  if (preferredBrands.some((brand) => candidateBrand.includes(brand.toLowerCase()))) return 0.18;
  return 0;
}

function pickBestCandidate(source: ProductRow, sourcePrice: number | null, candidates: KassalappProduct[], preferredBrands?: string[]) {
  const valid = candidates
    .filter((candidate) => candidate.id && candidate.name && candidate.current_price != null)
    .filter((candidate) => !source.ean || candidate.ean !== source.ean)
    .map((candidate) => {
      const price = toNumber(candidate.current_price, 0);
      const discountScore = sourcePrice && price > 0 ? Math.max(Math.min((sourcePrice - price) / sourcePrice, 0.35), -0.15) : 0;
      const score = brandScore(candidate, preferredBrands) + productNameScore(source, candidate) + discountScore;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score || toNumber(a.candidate.current_price) - toNumber(b.candidate.current_price));

  return valid[0]?.candidate ?? null;
}

export async function generateProductAlternatives({ limit = 50 }: { limit?: number } = {}) {
  const supabase = getSupabaseAdmin();
  const household = await ensureDefaultHousehold();

  const productsResult = await supabase
    .from("products")
    .select("id, household_id, name, brand, category, ean, created_at")
    .eq("household_id", household.id)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (productsResult.error) throw productsResult.error;

  const products = (productsResult.data ?? []) as ProductRow[];
  const productIds = products.map((product) => product.id);

  const observations = productIds.length
    ? await supabase
        .from("price_observations")
        .select("product_id, store_name, price, unit_price, observed_at")
        .in("product_id", productIds)
        .order("observed_at", { ascending: false })
    : { data: [], error: null };

  if (observations.error) throw observations.error;

  const latestPriceByProduct = new Map<string, ObservationRow>();
  for (const observation of (observations.data ?? []) as ObservationRow[]) {
    if (!latestPriceByProduct.has(observation.product_id)) latestPriceByProduct.set(observation.product_id, observation);
  }

  const createdOrUpdated: Array<{ productId: string; alternativeName: string }> = [];
  const skipped: Array<{ productName: string; reason: string }> = [];
  const errors: Array<{ productName: string; error: string }> = [];

  for (const product of products) {
    if (productIsAlreadyPrivateLabel(product)) {
      skipped.push({ productName: product.name, reason: "Produktet ser allerede ut som billig-/EMV-merke." });
      continue;
    }

    const rules = alternativeRulesForProduct(product);
    if (!rules.length) {
      skipped.push({ productName: product.name, reason: "Ingen trygg alternativregel ennå." });
      continue;
    }

    const latest = latestPriceByProduct.get(product.id) ?? null;
    const sourcePrice = latest?.price ?? null;

    for (const rule of rules.slice(0, 2)) {
      try {
        const results = await searchKassalappProducts(rule.query, 8);
        const candidate = pickBestCandidate(product, sourcePrice, results, rule.preferredBrands);

        if (!candidate?.current_price) {
          skipped.push({ productName: product.name, reason: `Fant ikke priset alternativ for "${rule.query}".` });
          continue;
        }

        const alternativePrice = toNumber(candidate.current_price, 0);
        const estimatedSaving = sourcePrice != null ? Number((sourcePrice - alternativePrice).toFixed(2)) : null;
        const confidence = Math.min(0.98, Math.max(0.1, rule.confidence + brandScore(candidate, rule.preferredBrands) + productNameScore(product, candidate)));

        const payload = {
          household_id: household.id,
          product_id: product.id,
          alternative_name: candidate.name,
          alternative_brand: candidate.brand ?? null,
          alternative_ean: candidate.ean ?? null,
          alternative_kassalapp_id: candidate.id,
          alternative_image_url: candidate.image ?? null,
          alternative_store_name: candidate.store?.name ?? null,
          alternative_store_code: candidate.store?.code ?? null,
          alternative_price: alternativePrice,
          alternative_unit_price: candidate.current_unit_price ?? null,
          alternative_source_url: candidate.url ?? null,
          match_type: rule.matchType,
          confidence: Number(confidence.toFixed(2)),
          estimated_saving: estimatedSaving,
          status: "candidate",
          reason: rule.reason,
          raw: candidate,
          updated_at: new Date().toISOString()
        };

        const existing = await supabase
          .from("product_alternatives")
          .select("id, status")
          .eq("product_id", product.id)
          .eq(candidate.ean ? "alternative_ean" : "alternative_kassalapp_id", candidate.ean ?? candidate.id)
          .limit(1);

        if (existing.error) throw existing.error;

        if (existing.data?.[0]) {
          if (existing.data[0].status === "accepted" || existing.data[0].status === "rejected") {
            skipped.push({ productName: product.name, reason: `${candidate.name} er allerede vurdert.` });
            continue;
          }

          const { error } = await supabase.from("product_alternatives").update(payload).eq("id", existing.data[0].id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("product_alternatives").insert(payload);
          if (error) throw error;
        }

        createdOrUpdated.push({ productId: product.id, alternativeName: candidate.name });
      } catch (error) {
        errors.push({ productName: product.name, error: error instanceof Error ? error.message : "Ukjent feil" });
      }
    }
  }

  return {
    household,
    scanned: products.length,
    createdOrUpdated: createdOrUpdated.length,
    skipped,
    errors
  };
}
