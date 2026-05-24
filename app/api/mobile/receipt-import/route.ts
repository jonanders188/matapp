import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { canonicalStoreIdentity, normalizeStoreCode } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { unitPricingColumnsForProduct } from "@/lib/unit-pricing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StoreOption = { storeKey: string; storeName: string; isEnabled: boolean | null; priority: number | null };
type ReceiptItem = { id: string; name: string; quantity: number; unit: "stk"; lineTotal: number; unitPrice: number; confidence: number; warning: string | null };
type ParsedReceipt = { storeKey: string | null; storeName: string | null; storeConfidence: number; receiptDate: string | null; items: ReceiptItem[]; warnings: string[] };
type BasisCandidate = { productId: string; ean: string | null; name: string; brand: string | null; category: string | null; packageSize: string | null; latestPrice: number | null; latestStorePrice: number | null; medianPrice: number | null; medianStorePrice: number | null; minRecentPrice: number | null; maxRecentPrice: number | null; priceObservationCount: number };
type AiMatch = { receiptLineId: string; productId: string | null; confidence: number; priceStatus: "normal" | "plausible_store_difference" | "suspicious" | "unknown"; shouldAutoImport: boolean; reason: string; warning: string | null };

async function insertPriceObservationRowsIgnoringDuplicates(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rows: Array<Record<string, unknown>>
) {
  let inserted = 0;
  let duplicates = 0;
  let updatedDuplicates = 0;

  for (const row of rows) {
    const insertResult = await supabase.from("price_observations").insert(row);
    if (!insertResult.error) {
      inserted += 1;
      continue;
    }

    const message = insertResult.error.message ?? "";
    if (insertResult.error.code === "23505" || message.includes("duplicate key value")) {
      duplicates += 1;

      const productId = typeof row.product_id === "string" ? row.product_id : null;
      const storeCode = typeof row.store_code === "string" ? row.store_code : null;
      const storeName = typeof row.store_name === "string" ? row.store_name : null;
      const source = typeof row.source === "string" ? row.source : null;
      const observedAt = typeof row.observed_at === "string" ? row.observed_at : null;
      const price = typeof row.price === "number" || typeof row.price === "string" ? row.price : null;

      if (productId && storeCode && storeName && source && observedAt && price !== null) {
        const updateResult = await supabase
          .from("price_observations")
          .update({
            unit_price: row.unit_price ?? null,
            comparison_unit: row.comparison_unit ?? null,
            package_quantity: row.package_quantity ?? null,
            package_unit: row.package_unit ?? null,
            unit_price_source: row.unit_price_source ?? null,
            raw: row.raw ?? null
          })
          .eq("product_id", productId)
          .eq("store_code", storeCode)
          .eq("store_name", storeName)
          .eq("source", source)
          .eq("observed_at", observedAt)
          .eq("price", price);

        if (updateResult.error) throw updateResult.error;
        updatedDuplicates += 1;
      }

      continue;
    }

    throw insertResult.error;
  }

  return { inserted, duplicates, updatedDuplicates };
}

async function safeInsertPriceObservationRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rows: Array<Record<string, unknown>>
) {
  let inserted = 0;
  let duplicates = 0;
  let enriched = 0;

  for (const row of rows) {
    const insertResult = await supabase.from("price_observations").insert(row);

    if (!insertResult.error) {
      inserted += 1;
      continue;
    }

    const message = insertResult.error.message ?? "";
    const isDuplicate = insertResult.error.code === "23505" || message.includes("duplicate key value");

    if (!isDuplicate) {
      console.error("[receipt-import] price observation insert failed", {
        code: insertResult.error.code,
        message: insertResult.error.message,
        details: insertResult.error.details,
        hint: insertResult.error.hint,
        row
      });
      throw insertResult.error;
    }

    duplicates += 1;

    const productId = typeof row.product_id === "string" ? row.product_id : null;
    const source = typeof row.source === "string" ? row.source : null;
    const observedAt = typeof row.observed_at === "string" ? row.observed_at : null;
    const price = typeof row.price === "number" || typeof row.price === "string" ? row.price : null;

    if (productId && source && observedAt && price !== null) {
      let update = supabase
        .from("price_observations")
        .update({
          unit_price: row.unit_price ?? null,
          comparison_unit: row.comparison_unit ?? null,
          package_quantity: row.package_quantity ?? null,
          package_unit: row.package_unit ?? null,
          unit_price_source: row.unit_price_source ?? null,
          raw: row.raw ?? null
        })
        .eq("product_id", productId)
        .eq("source", source)
        .eq("observed_at", observedAt)
        .eq("price", price)
        .is("unit_price_source", null);

      const storeCode = typeof row.store_code === "string" ? row.store_code : null;
      const storeName = typeof row.store_name === "string" ? row.store_name : null;
      if (storeCode) update = update.eq("store_code", storeCode);
      if (storeName) update = update.eq("store_name", storeName);

      const updateResult = await update;
      if (updateResult.error) {
        console.warn("[receipt-import] duplicate enrichment failed", {
          code: updateResult.error.code,
          message: updateResult.error.message,
          details: updateResult.error.details,
          hint: updateResult.error.hint
        });
      } else {
        enriched += 1;
      }
    }
  }

  return { inserted, duplicates, enriched };
}

function asNumber(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replaceAll("æ", "ae")
    .replaceAll("ä", "a")
    .replaceAll("ö", "o")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function median(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

function normalizeReceiptItem(value: unknown, index: number): ReceiptItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const name = String(item.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 3) return null;
  if (/(mva|trumf|bonus|sum|total|kjopesum|kjøpesum|bankaxept|visa|mastercard|kontant|avrunding)/i.test(name)) return null;

  const quantity = Math.max(1, Math.min(99, Math.floor(asNumber(item.quantity, 1))));
  const lineTotal = Number(asNumber(item.lineTotal, asNumber(item.unitPrice, 0) * quantity).toFixed(2));
  const unitPrice = Number(asNumber(item.unitPrice, quantity > 0 ? lineTotal / quantity : lineTotal).toFixed(2));
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 10000) return null;
  if (!Number.isFinite(lineTotal) || lineTotal <= 0 || lineTotal > 100000) return null;

  return {
    id: String(item.id ?? `ai-${index + 1}`),
    name,
    quantity,
    unit: "stk",
    lineTotal,
    unitPrice,
    confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.75))),
    warning: typeof item.warning === "string" && item.warning.trim() ? item.warning.trim() : null
  };
}

function parseOpenAiOutput(payload: unknown): string {
  const root = payload as Record<string, unknown>;
  if (typeof root.output_text === "string") return root.output_text;

  const output = Array.isArray(root.output) ? root.output : [];
  for (const entry of output) {
    if (!entry || typeof entry !== "object") continue;
    const content = Array.isArray((entry as Record<string, unknown>).content) ? ((entry as Record<string, unknown>).content as unknown[]) : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.output_text === "string") return record.output_text;
    }
  }

  throw new Error("AI svarte uten lesbar JSON.");
}

async function callOpenAi(body: unknown) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("OPENAI_API_KEY mangler."), { status: 503 });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "AI-kall feilet.";
    throw Object.assign(new Error(message), { status: response.status });
  }

  return JSON.parse(parseOpenAiOutput(payload));
}

function matchStore(parsed: ParsedReceipt, stores: StoreOption[], confirmedStoreKey?: string | null) {
  const confirmed = String(confirmedStoreKey ?? "").trim();
  if (confirmed) {
    const store = stores.find((candidate) => candidate.storeKey === confirmed);
    if (store) return { store, needsConfirmation: false, reason: null as string | null };
  }

  const parsedKey = normalizeStoreCode(parsed.storeKey ?? parsed.storeName ?? "");
  const parsedName = normalizeText(parsed.storeName ?? "");
  const store = stores.find((candidate) => {
    const key = normalizeStoreCode(candidate.storeKey);
    const name = normalizeText(candidate.storeName);
    return key === parsedKey || name === parsedName || (parsedName && (name.includes(parsedName) || parsedName.includes(name)));
  });

  if (!store || parsed.storeConfidence < 0.72) {
    return {
      store: null,
      needsConfirmation: true,
      reason: parsed.storeName
        ? `AI tror butikken er ${parsed.storeName}, men matchen er usikker. Velg registrert butikk før import.`
        : "AI fant ikke sikker butikk på kvitteringen. Velg registrert butikk før import."
    };
  }

  return { store, needsConfirmation: false, reason: null as string | null };
}

async function parseReceiptImage(imageBase64: string, stores: StoreOption[]) {
  const allowedStores = stores.map((store) => ({ storeKey: store.storeKey, storeName: store.storeName }));
  const model = process.env.OPENAI_RECEIPT_MODEL || "gpt-4.1-mini";

  const parsed = await callOpenAi({
    model,
    max_output_tokens: 12000,
    input: [
      { role: "system", content: [{ type: "input_text", text:
        "Du leser norske dagligvarekvitteringer visuelt. Returner ALLE produktlinjer fra topp til bunn. " +
        "Du skal også lese butikk og kvitteringsdato. Butikk må bare velges blant allowedStores. Hvis du er usikker, returner storeKey=null eller lav storeConfidence. " +
        "Ignorer MVA, Trumf, bonus, summer, totalsum, betaling, kort, kontant, rabattlinjer og footer. " +
        "Kjøpt antall står ofte på linjen rett under produktet: 1 stk, 1stk, 2 stk, 6 stk. Ikke bruk pakkestørrelse som kjøpt antall. " +
        "lineTotal er total linjepris. unitPrice er lineTotal delt på kjøpt antall. Hvis antall er uklart, bruk quantity=1 og warning. " +
        "Bevar norske tegn så godt du kan, men vær klar over OCR-feil: ae/a kan være æ, o kan være ø, a kan være å." }] },
      { role: "user", content: [{ type: "input_text", text: `allowedStores=${JSON.stringify(allowedStores)}. Les kvitteringen og returner strukturert JSON. Dato skal være ISO YYYY-MM-DD hvis mulig.` }, { type: "input_image", image_url: imageBase64 }] }
    ],
    text: { format: { type: "json_schema", name: "receipt_import_parse", strict: true, schema: {
      type: "object", additionalProperties: false,
      properties: {
        storeKey: { type: ["string", "null"] },
        storeName: { type: ["string", "null"] },
        storeConfidence: { type: "number" },
        receiptDate: { type: ["string", "null"] },
        items: { type: "array", items: { type: "object", additionalProperties: false, properties: {
          id: { type: "string" }, name: { type: "string" }, quantity: { type: "number" }, unit: { type: "string", enum: ["stk"] }, lineTotal: { type: "number" }, unitPrice: { type: "number" }, confidence: { type: "number" }, warning: { type: ["string", "null"] }
        }, required: ["id", "name", "quantity", "unit", "lineTotal", "unitPrice", "confidence", "warning"] } },
        warnings: { type: "array", items: { type: "string" } }
      },
      required: ["storeKey", "storeName", "storeConfidence", "receiptDate", "items", "warnings"]
    } } }
  }) as ParsedReceipt;

  return {
    ...parsed,
    storeConfidence: Math.max(0, Math.min(1, asNumber(parsed.storeConfidence, 0))),
    items: (Array.isArray(parsed.items) ? parsed.items : []).map(normalizeReceiptItem).filter((item): item is ReceiptItem => item !== null),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((warning) => typeof warning === "string") : []
  };
}

async function loadBasisCandidates(householdId: string, storeKey: string): Promise<BasisCandidate[]> {
  const supabase = getSupabaseAdmin();

  const householdProductsResult = await supabase.from("household_products").select("product_id").eq("household_id", householdId).eq("is_basis", true);
  if (householdProductsResult.error) throw householdProductsResult.error;
  const productIds = (householdProductsResult.data ?? []).map((row) => row.product_id).filter(Boolean) as string[];
  if (!productIds.length) return [];

  const productsResult = await supabase.from("products").select("id, ean, name, brand, category, package_size").in("id", productIds);
  if (productsResult.error) throw productsResult.error;

  const observationsResult = await supabase.from("price_observations").select("product_id, store_code, store_name, price, observed_at").in("product_id", productIds).gt("price", 0).order("observed_at", { ascending: false }).limit(2000);
  if (observationsResult.error) throw observationsResult.error;

  const byProduct = new Map<string, Array<{ store_code: string | null; store_name: string | null; price: number; observed_at: string }>>();
  for (const observation of observationsResult.data ?? []) {
    const rows = byProduct.get(observation.product_id) ?? [];
    rows.push({ store_code: observation.store_code, store_name: observation.store_name, price: Number(observation.price), observed_at: observation.observed_at });
    byProduct.set(observation.product_id, rows);
  }

  return (productsResult.data ?? []).map((product) => {
    const observations = byProduct.get(product.id) ?? [];
    const sameStore = observations.filter((observation) => normalizeStoreCode(observation.store_code || observation.store_name) === storeKey);
    const prices = observations.map((observation) => Number(observation.price)).filter((price) => Number.isFinite(price) && price > 0);
    const storePrices = sameStore.map((observation) => Number(observation.price)).filter((price) => Number.isFinite(price) && price > 0);
    return {
      productId: product.id,
      ean: product.ean ?? null,
      name: product.name,
      brand: product.brand ?? null,
      category: product.category ?? null,
      packageSize: product.package_size ?? null,
      latestPrice: prices[0] ?? null,
      latestStorePrice: storePrices[0] ?? null,
      medianPrice: median(prices),
      medianStorePrice: median(storePrices),
      minRecentPrice: prices.length ? Math.min(...prices) : null,
      maxRecentPrice: prices.length ? Math.max(...prices) : null,
      priceObservationCount: prices.length
    } satisfies BasisCandidate;
  });
}

function cheapTokenScore(line: ReceiptItem, candidate: BasisCandidate) {
  const lineText = normalizeText(line.name);
  const productText = normalizeText(`${candidate.name} ${candidate.brand ?? ""} ${candidate.packageSize ?? ""}`);
  const tokens = [...new Set(productText.split(/\s+/).filter((token) => token.length >= 3))];
  return tokens.reduce((sum, token) => sum + (lineText.includes(token) ? token.length : 0), 0);
}

function candidateSubsetForLine(line: ReceiptItem, candidates: BasisCandidate[]) {
  return [...candidates].map((candidate) => ({ candidate, score: cheapTokenScore(line, candidate) })).sort((a, b) => b.score - a.score).slice(0, 18).map((entry) => entry.candidate);
}

function pricePlausible(line: ReceiptItem, candidate: BasisCandidate | undefined, priceStatus: AiMatch["priceStatus"]) {
  if (!candidate) return false;
  if (priceStatus === "suspicious") return false;
  const reference = candidate.medianStorePrice ?? candidate.latestStorePrice ?? candidate.medianPrice ?? candidate.latestPrice;
  if (!reference || reference <= 0) return true;
  const deviation = Math.abs(line.unitPrice - reference) / reference;
  if (candidate.medianStorePrice || candidate.latestStorePrice) return deviation <= 0.35;
  return deviation <= 0.45;
}

async function matchReceiptLines(items: ReceiptItem[], candidates: BasisCandidate[], storeName: string) {
  if (!items.length || !candidates.length) return [] as AiMatch[];
  const model = process.env.OPENAI_RECEIPT_MODEL || "gpt-4.1-mini";
  const lineCandidateMap = items.map((item) => ({ receiptLine: item, basisCandidates: candidateSubsetForLine(item, candidates) }));

  const result = await callOpenAi({
    model,
    max_output_tokens: 12000,
    input: [
      { role: "system", content: [{ type: "input_text", text:
        "Du matcher norske kvitteringslinjer mot husholdningens basisvarer. Du skal bare velge blant basisCandidates for hver linje, eller null. " +
        "Ikke match mot hele Kassalapp. Bruk produktnavn, merke, pakningsstørrelse, antall og unitPrice. " +
        "Norske tegn/OCR: behandle torkerull≈tørkerull, strompe≈strømpe, frittgaende≈frittgående, romme≈rømme, toymykner≈tøymykner, ae/a≈æ, o≈ø, a≈å. " +
        "Bruk historiske priser som støtte. Samme butikk-historikk er viktigst. KIWI kan normalt være 5-12 % billigere enn MENY; ikke marker det som feil alene. " +
        "Hvis quantity > 1 skal unitPrice sammenlignes med historikk, ikke lineTotal. Pris alene er aldri nok til match. " +
        "Autoimport bare når samme produkt er tydelig og pris er plausibel. Ved generiske varer, vektvarer, flere sterke kandidater eller mistenkelig pris skal shouldAutoImport=false." }] },
      { role: "user", content: [{ type: "input_text", text: `Butikk: ${storeName}. Match disse kvitteringslinjene mot basisvarer: ${JSON.stringify(lineCandidateMap)}` }] }
    ],
    text: { format: { type: "json_schema", name: "receipt_basis_matches", strict: true, schema: {
      type: "object", additionalProperties: false,
      properties: { matches: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        receiptLineId: { type: "string" }, productId: { type: ["string", "null"] }, confidence: { type: "number" }, priceStatus: { type: "string", enum: ["normal", "plausible_store_difference", "suspicious", "unknown"] }, shouldAutoImport: { type: "boolean" }, reason: { type: "string" }, warning: { type: ["string", "null"] }
      }, required: ["receiptLineId", "productId", "confidence", "priceStatus", "shouldAutoImport", "reason", "warning"] } } },
      required: ["matches"]
    } } }
  }) as { matches?: AiMatch[] };
  return Array.isArray(result.matches) ? result.matches : [];
}

function receiptLineToCacheLine(line: ReceiptItem, match?: AiMatch | null) {
  return { id: line.id, text: line.name, price: line.unitPrice, quantity: line.quantity, quantityUnit: "stk" as const, unitPrice: line.unitPrice, totalPrice: line.lineTotal, warning: match?.warning ?? line.warning ?? null };
}

export async function POST(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    const body = await request.json().catch(() => null) as {
      imageBase64?: string;
      confirmedStoreKey?: string;
      importConfirmed?: boolean;
      fastImport?: boolean;
      storeKey?: string;
      storeName?: string;
      receiptDate?: string | null;
      observedAt?: string | null;
      secureMatches?: Array<{
        receiptLineId: string;
        productId: string | null;
        confidence: number;
        priceStatus: string;
        shouldAutoImport: boolean;
        reason: string;
        warning: string | null;
        line: { id: string; name?: string; text?: string; unitPrice?: number; price?: number; quantity?: number; lineTotal?: number; totalPrice?: number } | null;
        product?: { productId?: string; name?: string; brand?: string | null; category?: string | null; packageSize?: string | null } | null;
      }>;
      remainingLines?: Array<{ id: string; name?: string; text?: string; unitPrice?: number; price?: number; quantity?: number; lineTotal?: number; totalPrice?: number; warning?: string | null }>;
    } | null;
    const imageBase64 = String(body?.imageBase64 ?? "");
    if (!body?.importConfirmed && !imageBase64.startsWith("data:image/")) {
      return NextResponse.json({ error: "Mangler gyldig kvitteringsbilde." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const storesResult = await supabase.from("household_store_preferences").select("store_key, store_name, is_enabled, priority").eq("household_id", current.householdId).order("priority", { ascending: true });
    if (storesResult.error) throw storesResult.error;

    const stores: StoreOption[] = (storesResult.data ?? []).filter((store) => store.is_enabled !== false).map((store) => ({ storeKey: store.store_key, storeName: store.store_name, isEnabled: store.is_enabled, priority: store.priority }));
    if (!stores.length) return NextResponse.json({ error: "Ingen aktive butikker er registrert. Aktiver butikker i Admin først." }, { status: 400 });

    if (body?.importConfirmed && body.fastImport && Array.isArray(body.secureMatches)) {
      const requestedStoreKey = String(body.confirmedStoreKey ?? body.storeKey ?? "").trim();
      const selectedStore = stores.find((store) => store.storeKey === requestedStoreKey);
      if (!selectedStore) {
        return NextResponse.json({ error: "Velg registrert butikk før import." }, { status: 400 });
      }

      const storeIdentity = canonicalStoreIdentity(selectedStore.storeKey, selectedStore.storeName);
      const observedAt = body.observedAt && Number.isFinite(Date.parse(body.observedAt))
        ? new Date(body.observedAt).toISOString()
        : body.receiptDate && Number.isFinite(Date.parse(body.receiptDate))
          ? new Date(body.receiptDate).toISOString()
          : new Date().toISOString();

      const rows = body.secureMatches.flatMap((match) => {
        if (!match.productId || !match.shouldAutoImport || Number(match.confidence ?? 0) < 0.9) return [];
        const line = match.line;
        if (!line) return [];

        const unitPrice = asNumber(line.unitPrice ?? line.price, 0);
        const quantity = Math.max(1, Math.floor(asNumber(line.quantity, 1)));
        const lineTotal = asNumber(line.lineTotal ?? line.totalPrice, unitPrice * quantity);
        const lineName = String(line.name ?? line.text ?? "").trim();

        if (!unitPrice || unitPrice <= 0 || unitPrice > 10000) return [];

        const unitPricing = unitPricingColumnsForProduct(
          {
            name: match.product?.name ?? lineName,
            brand: match.product?.brand ?? null,
            category: match.product?.category ?? null,
            package_size: match.product?.packageSize ?? null
          },
          unitPrice
        );

        return [{
          product_id: match.productId,
          household_id: current.householdId,
          observed_by_household_id: current.householdId,
          scope: "global",
          visibility: "public",
          store_code: storeIdentity.store_code,
          store_name: storeIdentity.store_name,
          price: unitPrice,
          unit_price: unitPricing.unit_price,
          comparison_unit: unitPricing.comparison_unit,
          package_quantity: unitPricing.package_quantity,
          package_unit: unitPricing.package_unit,
          unit_price_source: unitPricing.unit_price_source,
          observed_at: observedAt,
          source: "receipt-ai-auto",
          source_url: null,
          raw: {
            receipt_line_id: line.id ?? match.receiptLineId,
            receipt_line_text: lineName,
            receipt_quantity: quantity,
            receipt_total_price: lineTotal,
            receipt_unit_price: unitPrice,
            ai_confidence: match.confidence,
            ai_reason: match.reason,
            ai_warning: match.warning,
            price_status: match.priceStatus,
            imported_at: new Date().toISOString(),
            fast_import: true,
            unit_pricing: unitPricing.raw_unit_pricing
          }
        }];
      });

      const importResult = rows.length
        ? await safeInsertPriceObservationRows(supabase, rows)
        : { inserted: 0, duplicates: 0, enriched: 0 };

      return NextResponse.json({
        data: {
          needsStoreConfirmation: false,
          storeKey: selectedStore.storeKey,
          storeName: storeIdentity.store_name,
          receiptDate: body.receiptDate ?? null,
          observedAt,
          linesRead: rows.length + (body.remainingLines?.length ?? 0),
          secureMatches: body.secureMatches,
          reviewMatches: [],
          unmatchedLines: [],
          remainingLines: body.remainingLines ?? [],
          importedCount: importResult.inserted,
          duplicateCount: importResult.duplicates,
          importConfirmed: true,
          warnings: importResult.duplicates ? [`${importResult.duplicates} prisobservasjoner fantes allerede. ${importResult.enriched ?? 0} ble oppdatert med enhetsprisdata.`] : []
        }
      });
    }

    const parsed = await parseReceiptImage(imageBase64, stores);
    if (!parsed.items.length) return NextResponse.json({ error: "AI fant ingen produktlinjer på kvitteringen." }, { status: 422 });

    const storeMatch = matchStore(parsed, stores, body?.confirmedStoreKey ?? null);
    if (storeMatch.needsConfirmation || !storeMatch.store) {
      return NextResponse.json({ data: { needsStoreConfirmation: true, reason: storeMatch.reason, detectedStoreName: parsed.storeName, detectedStoreKey: parsed.storeKey, storeConfidence: parsed.storeConfidence, receiptDate: parsed.receiptDate, linesRead: parsed.items.length, stores, warnings: parsed.warnings } });
    }

    const storeIdentity = canonicalStoreIdentity(storeMatch.store.storeKey, storeMatch.store.storeName);
    const candidates = await loadBasisCandidates(current.householdId, storeIdentity.store_code);
    const matches = await matchReceiptLines(parsed.items, candidates, storeIdentity.store_name);
    const candidateById = new Map(candidates.map((candidate) => [candidate.productId, candidate]));
    const lineById = new Map(parsed.items.map((item) => [item.id, item]));

    const secureMatches = matches.filter((match) => {
      if (!match.productId || !match.shouldAutoImport || match.confidence < 0.9) return false;
      const line = lineById.get(match.receiptLineId);
      return Boolean(line && pricePlausible(line, candidateById.get(match.productId), match.priceStatus));
    });
    const secureLineIds = new Set(secureMatches.map((match) => match.receiptLineId));
    const reviewMatches = matches.filter((match) => match.productId && !secureLineIds.has(match.receiptLineId));
    const unmatchedLines = parsed.items.filter((item) => !matches.some((match) => match.receiptLineId === item.id && match.productId));
    const remainingLines = parsed.items.filter((item) => !secureLineIds.has(item.id)).map((item) => receiptLineToCacheLine(item, matches.find((match) => match.receiptLineId === item.id)));
    const observedAt = parsed.receiptDate && Number.isFinite(Date.parse(parsed.receiptDate)) ? new Date(parsed.receiptDate).toISOString() : new Date().toISOString();

    let insertedCount = 0;
    if (body?.importConfirmed) {
      const rows = secureMatches.flatMap((match) => {
        const line = lineById.get(match.receiptLineId);
        if (!line || !match.productId) return [];
        const candidate = candidateById.get(match.productId);
        const unitPricing = unitPricingColumnsForProduct(
          {
            name: candidate?.name ?? line.name,
            brand: candidate?.brand ?? null,
            category: candidate?.category ?? null,
            package_size: candidate?.packageSize ?? null
          },
          line.unitPrice
        );
        return [{ product_id: match.productId, household_id: current.householdId, observed_by_household_id: current.householdId, scope: "global", visibility: "public", store_code: storeIdentity.store_code, store_name: storeIdentity.store_name, price: line.unitPrice, unit_price: unitPricing.unit_price, comparison_unit: unitPricing.comparison_unit, package_quantity: unitPricing.package_quantity, package_unit: unitPricing.package_unit, unit_price_source: unitPricing.unit_price_source, observed_at: observedAt, source: "receipt-ai-auto", source_url: null, raw: { receipt_line_id: line.id, receipt_line_text: line.name, receipt_quantity: line.quantity, receipt_total_price: line.lineTotal, receipt_unit_price: line.unitPrice, ai_confidence: match.confidence, ai_reason: match.reason, ai_warning: match.warning, price_status: match.priceStatus, imported_at: new Date().toISOString(), unit_pricing: unitPricing.raw_unit_pricing } }];
      });
      if (rows.length) {
        const insertResult = await supabase.from("price_observations").insert(rows);
        if (insertResult.error) throw insertResult.error;
        insertedCount = rows.length;
      }
    }

    return NextResponse.json({ data: { needsStoreConfirmation: false, storeKey: storeMatch.store.storeKey, storeName: storeIdentity.store_name, receiptDate: parsed.receiptDate, observedAt, linesRead: parsed.items.length, basisCandidates: candidates.length, secureMatches: secureMatches.map((match) => ({ ...match, line: lineById.get(match.receiptLineId) ?? null, product: match.productId ? candidateById.get(match.productId) ?? null : null })), reviewMatches: reviewMatches.map((match) => ({ ...match, line: lineById.get(match.receiptLineId) ?? null, product: match.productId ? candidateById.get(match.productId) ?? null : null })), unmatchedLines, remainingLines, importedCount: insertedCount, importConfirmed: Boolean(body?.importConfirmed), warnings: parsed.warnings } });
  } catch (error) {
    console.error("[receipt-import] request failed", error);
    return apiErrorResponse(error);
  }
}
