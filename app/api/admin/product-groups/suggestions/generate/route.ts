import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { loadActiveNegativeMatchKeys, pairKey } from "@/lib/product-group-negative-matches";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductCandidate = {
  id: string;
  ean: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  package_size: string | null;
  comparison_unit: string | null;
  latest_unit_price: number | null;
  package_quantity: number | null;
  package_unit: string | null;
  normalized_name: string;
};

type AiGroupMember = {
  product_id: string;
  relationship_type: "same_product_different_package" | "same_product_variant" | "same_category_alternative" | "not_comparable";
  confidence: number;
  reason: string;
};

type AiGroup = {
  group_name: string;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
  confidence: number;
  reason: string;
  members: AiGroupMember[];
};

type AiResponse = {
  groups: AiGroup[];
};

const relationshipTypes = new Set([
  "same_product_different_package",
  "same_product_variant",
  "same_category_alternative",
  "not_comparable"
]);

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function expandTargetQueryTerms(targetQuery: string | null) {
  const normalized = normalizeText(targetQuery);
  const terms = new Set(normalized.split(/\s+/).filter(Boolean));

  if (terms.has("cola") || terms.has("coca")) {
    terms.add("cola");
    terms.add("coca");
  }

  if (terms.has("zero")) {
    terms.add("sukker");
    terms.add("sukkerfri");
    terms.add("uten");
  }

  if (terms.has("sukkerfri") || (terms.has("uten") && terms.has("sukker"))) {
    terms.add("zero");
  }

  return [...terms].filter((term) => term.length >= 2).slice(0, 8);
}

function productMatchesTargetQuery(product: ProductCandidate, targetQuery: string | null) {
  if (!targetQuery) return true;
  const terms = expandTargetQueryTerms(targetQuery);
  if (!terms.length) return true;

  const haystack = normalizeText(
    `${product.name} ${product.brand ?? ""} ${product.category ?? ""} ${product.ean ?? ""}`
  );

  return terms.some((term) => haystack.includes(term));
}

function inferredComparisonUnitFromText(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;

  if (/\b\d+(?:[.,]\d+)?\s*(kg|kilo|kilogram|g|gram)\b/.test(text)) return "kg";
  if (/\b\d+(?:[.,]\d+)?\s*(l|liter|litre|ltr|dl|cl|ml)\b/.test(text)) return "l";
  if (/\b\d+\s*(stk|pk|pakk|pakke|pakker|piece|pieces|rl|rull|ruller)\b/.test(text)) return "stk";

  return null;
}

function inferredComparisonUnitForProduct(product: {
  name?: string | null;
  package_size?: string | null;
  category?: string | null;
}) {
  const fromPackage = inferredComparisonUnitFromText(product.package_size);
  if (fromPackage) return fromPackage;

  const fromName = inferredComparisonUnitFromText(product.name);
  if (fromName) return fromName;

  const category = normalizeText(product.category);
  if (/(brus|juice|saft|melk|drikke|cider)/.test(category)) return "l";
  if (/(sjokolade|pasta|ost|bacon|kjott|fisk|ris|mel|kaffe)/.test(category)) return "kg";
  if (/(dopapir|toalettpapir|torkerull|bleie|tablett|kapsel|egg)/.test(category)) return "stk";

  return null;
}

function normalizeProductName(product: { name?: string | null; brand?: string | null }) {
  const brand = normalizeText(product.brand);
  let text = normalizeText(product.name);

  if (brand) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\b${escaped}\\b`, "g"), " ");
  }

  return text
    .replace(/\bstr\s*[.]?\s*\d+\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(kg|kilo|kilogram|g|gram|l|liter|litre|ltr|dl|cl|ml)\b/g, " ")
    .replace(/\b\d+\s*(stk|pk|pakk|pakke|pakker|rl|rull|ruller|egg|bleie|bleier|tablett|tabletter|tabs|vask|piece|pieces)\b/g, " ")
    .replace(/\b\d+\s*x\s*\d+\s*(m|cm|mm)\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*%\b/g, (match) => ` ${match.trim()} `)
    .replace(/\b(ass|assortert|ca|cirka)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(value.split(/\s+/).filter((token) => token.length >= 2));
}

function jaccard(a: string, b: string) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  return intersection / (left.size + right.size - intersection);
}

function pairLooksRelated(a: ProductCandidate, b: ProductCandidate) {
  // If both units are known and different, do not compare.
  // If one or both are missing, allow the text/brand/category checks to decide.
  if (a.comparison_unit && b.comparison_unit && a.comparison_unit !== b.comparison_unit) return false;

  const brandA = normalizeText(a.brand);
  const brandB = normalizeText(b.brand);
  const categoryA = normalizeText(a.category);
  const categoryB = normalizeText(b.category);

  const brandMatches = !brandA || !brandB || brandA === brandB || brandA.includes(brandB) || brandB.includes(brandA);
  const categoryMatches = !categoryA || !categoryB || categoryA === categoryB || categoryA.includes(categoryB) || categoryB.includes(categoryA);

  const similarity = jaccard(a.normalized_name, b.normalized_name);
  if (brandMatches && categoryMatches && similarity >= 0.25) return true;

  const shorter = a.normalized_name.length < b.normalized_name.length ? a.normalized_name : b.normalized_name;
  const longer = a.normalized_name.length < b.normalized_name.length ? b.normalized_name : a.normalized_name;
  if (brandMatches && shorter.length >= 4 && longer.includes(shorter)) return true;

  const tokensA = tokenSet(a.normalized_name);
  const tokensB = tokenSet(b.normalized_name);
  for (const token of tokensA) {
    if (token.length >= 4 && tokensB.has(token) && categoryMatches) return true;
  }

  return false;
}

function buildDeterministicCandidateSets(products: ProductCandidate[], maxSets: number, blockedPairs = new Set<string>()) {
  const bucketMap = new Map<string, ProductCandidate[]>();

  for (const product of products) {
    const brand = normalizeText(product.brand) || "unknown-brand";
    const category = normalizeText(product.category) || "unknown-category";
    const unit = product.comparison_unit ?? "unknown-unit";
    const key = `${brand}|${category}|${unit}`;
    const current = bucketMap.get(key) ?? [];
    current.push(product);
    bucketMap.set(key, current);
  }

  const candidateSets: ProductCandidate[][] = [];

  for (const bucket of bucketMap.values()) {
    if (bucket.length < 2) continue;

    const visited = new Set<string>();

    for (const product of bucket) {
      if (visited.has(product.id)) continue;

      const component = [product];
      visited.add(product.id);

      for (const other of bucket) {
        if (visited.has(other.id) || other.id === product.id) continue;
        if (blockedPairs.has(pairKey(product.id, other.id))) continue;
        if (blockedPairs.has(pairKey(product.id, other.id))) continue;
        if (pairLooksRelated(product, other)) {
          component.push(other);
          visited.add(other.id);
        }
      }

      if (component.length >= 2) {
        candidateSets.push(component.slice(0, 12));
      }
    }
  }

  return candidateSets
    .sort((a, b) => b.length - a.length)
    .slice(0, maxSets);
}

async function parseOpenAiOutput(payload: unknown): Promise<string> {
  const root = payload as Record<string, unknown>;

  if (typeof root.output_text === "string") return root.output_text;

  const output = Array.isArray(root.output) ? root.output : [];
  for (const entry of output) {
    if (!entry || typeof entry !== "object") continue;
    const content = Array.isArray((entry as Record<string, unknown>).content)
      ? ((entry as Record<string, unknown>).content as unknown[])
      : [];

    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.output_text === "string") return record.output_text;
    }
  }

  throw new Error("AI svarte uten lesbar JSON.");
}

function normalizeAiGroup(value: unknown, allowedProductIds: Set<string>): AiGroup | null {
  if (!value || typeof value !== "object") return null;
  const group = value as Record<string, unknown>;

  const groupName = cleanText(group.group_name);
  if (!groupName) return null;

  const membersRaw = Array.isArray(group.members) ? group.members : [];
  const members: AiGroupMember[] = [];

  for (const rawMember of membersRaw) {
    if (!rawMember || typeof rawMember !== "object") continue;
    const member = rawMember as Record<string, unknown>;
    const productId = cleanText(member.product_id);
    if (!allowedProductIds.has(productId)) continue;

    const relationshipType = cleanText(member.relationship_type) as AiGroupMember["relationship_type"];
    if (!relationshipTypes.has(relationshipType)) continue;
    if (relationshipType === "not_comparable") continue;

    const confidence = Math.max(0, Math.min(1, Number(member.confidence ?? 0)));
    if (!Number.isFinite(confidence) || confidence < 0.65) continue;

    members.push({
      product_id: productId,
      relationship_type: relationshipType,
      confidence,
      reason: cleanText(member.reason) || "AI vurderte produktet som sammenlignbart."
    });
  }

  if (members.length < 2) return null;

  const confidence = Math.max(0, Math.min(1, Number(group.confidence ?? Math.min(...members.map((member) => member.confidence)))));
  if (!Number.isFinite(confidence) || confidence < 0.7) return null;

  return {
    group_name: groupName,
    brand: cleanText(group.brand) || null,
    category: cleanText(group.category) || null,
    comparison_unit: cleanText(group.comparison_unit) || null,
    confidence,
    reason: cleanText(group.reason) || "AI foreslo overordnet vare basert på navn, merke, kategori, enhetspris og pakning.",
    members
  };
}

function deterministicSuggestion(candidateSet: ProductCandidate[]): AiGroup | null {
  const first = candidateSet[0];
  if (!first) return null;

  const normalizedName = first.normalized_name || first.name;
  const groupName = [first.brand, normalizedName]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const members = candidateSet.map((product) => ({
    product_id: product.id,
    relationship_type: "same_product_different_package" as const,
    confidence: 0.72,
    reason: "Deterministisk forslag: samme merke/kategori/enhet og svært likt navn etter fjerning av pakningsstørrelse."
  }));

  return {
    group_name: groupName,
    brand: first.brand,
    category: first.category,
    comparison_unit: first.comparison_unit,
    confidence: 0.72,
    reason: "Foreløpig forslag laget av eksisterende produktdata. AI var ikke tilgjengelig.",
    members
  };
}

async function askAiForGroups(candidateSet: ProductCandidate[]): Promise<AiGroup[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const fallback = deterministicSuggestion(candidateSet);
    return fallback ? [fallback] : [];
  }

  const allowedProductIds = new Set(candidateSet.map((product) => product.id));
  const model = process.env.OPENAI_PRODUCT_GROUP_MODEL || "gpt-4.1-mini";

  const inputProducts = candidateSet.map((product) => ({
    id: product.id,
    ean: product.ean,
    name: product.name,
    normalized_name: product.normalized_name,
    brand: product.brand,
    category: product.category,
    package_size: product.package_size,
    comparison_unit: product.comparison_unit,
    latest_unit_price: product.latest_unit_price,
    package_quantity: product.package_quantity,
    package_unit: product.package_unit
  }));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 5000,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `Du er System Admin-assistent for en norsk dagligvareapp. Oppgaven er å foreslå globale overordnede varer, ikke pakning.

Regler:
- Prisobservasjoner beholdes på konkret EAN. Du foreslår bare overordnede varer for sammenligning.
- Gruppér kun produkter som forbruker trygt kan sammenligne på enhetspris.
- Ignorer pakningsstørrelse når varen ellers er samme faktiske vare.
- Vær mindre streng i forslagene. Ta med sannsynlige kandidater og varianter, fordi System Admin kan fjerne produkter før godkjenning. Ikke ta med åpenbart feil kategori.
- Vanlig vs glutenfri, blokk vs skivet, original vs lett/sukkerfri er normalt variant, ikke samme_product_different_package.
- Bruk same_product_different_package bare når det faktisk er samme vare med annen størrelse.
- Bruk same_product_variant når samme produktfamilie, men variant/form gjør at admin må vurdere.
- Ikke inkluder not_comparable-EAN-varer i overordnede varer.
- Skriv korte norske begrunnelser. Hvis søket gjelder melkesjokolade, skill mellom sjokoladeplate, iskremvariant og smøreostvariant, men ta gjerne med varianter for System Admin-vurdering.`
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({ products: inputProducts }, null, 2)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "product_group_suggestions",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              groups: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    group_name: { type: "string" },
                    brand: { type: ["string", "null"] },
                    category: { type: ["string", "null"] },
                    comparison_unit: { type: ["string", "null"] },
                    confidence: { type: "number" },
                    reason: { type: "string" },
                    members: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          product_id: { type: "string" },
                          relationship_type: {
                            type: "string",
                            enum: [
                              "same_product_different_package",
                              "same_product_variant",
                              "same_category_alternative",
                              "not_comparable"
                            ]
                          },
                          confidence: { type: "number" },
                          reason: { type: "string" }
                        },
                        required: ["product_id", "relationship_type", "confidence", "reason"]
                      }
                    }
                  },
                  required: ["group_name", "brand", "category", "comparison_unit", "confidence", "reason", "members"]
                }
              }
            },
            required: ["groups"]
          }
        }
      }
    })
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("[product-groups/suggestions/generate] AI failed", payload);
    const fallback = deterministicSuggestion(candidateSet);
    return fallback ? [fallback] : [];
  }

  const jsonText = await parseOpenAiOutput(payload);
  const parsed = JSON.parse(jsonText) as AiResponse;

  return (parsed.groups ?? [])
    .map((group) => normalizeAiGroup(group, allowedProductIds))
    .filter((group): group is AiGroup => Boolean(group));
}

async function loadProductsForGrouping(limit: number, onlyUngrouped: boolean, targetQuery: string | null) {
  const supabase = getSupabaseAdmin();

  const memberProductIds = new Set<string>();
  if (onlyUngrouped) {
    const { data: members, error: membersError } = await supabase
      .from("product_group_members")
      .select("product_id");

    if (membersError) throw membersError;
    for (const member of members ?? []) {
      if (member.product_id) memberProductIds.add(String(member.product_id));
    }
  }

  let productsQuery = supabase
    .from("products")
    .select("id, ean, name, brand, category, package_size, comparison_unit")
    .order("name", { ascending: true })
    .limit(limit);

  if (targetQuery) {
    const terms = expandTargetQueryTerms(targetQuery);
    const filters = terms.flatMap((term) => {
      const pattern = `%${term.replace(/[%_]/g, "")}%`;
      return [
        `name.ilike.${pattern}`,
        `brand.ilike.${pattern}`,
        `category.ilike.${pattern}`,
        `ean.ilike.${pattern}`
      ];
    });

    if (filters.length) {
      productsQuery = productsQuery.or(filters.join(","));
    }
  }

  const { data: products, error: productsError } = await productsQuery;

  if (productsError) throw productsError;

  const productIds = (products ?? [])
    .map((product) => String(product.id))
    .filter((id) => !memberProductIds.has(id));

  const latestByProduct = new Map<string, {
    comparison_unit: string | null;
    unit_price: number | null;
    package_quantity: number | null;
    package_unit: string | null;
  }>();

  if (productIds.length) {
    const { data: observations, error: observationsError } = await supabase
      .from("price_observations")
      .select("product_id, comparison_unit, unit_price, package_quantity, package_unit, observed_at")
      .in("product_id", productIds)
      .not("comparison_unit", "is", null)
      .order("observed_at", { ascending: false })
      .limit(Math.min(productIds.length * 8, 3000));

    if (observationsError) throw observationsError;

    for (const observation of observations ?? []) {
      const productId = String(observation.product_id ?? "");
      if (!productId || latestByProduct.has(productId)) continue;
      latestByProduct.set(productId, {
        comparison_unit: observation.comparison_unit ? String(observation.comparison_unit) : null,
        unit_price: observation.unit_price === null || observation.unit_price === undefined ? null : Number(observation.unit_price),
        package_quantity: observation.package_quantity === null || observation.package_quantity === undefined ? null : Number(observation.package_quantity),
        package_unit: observation.package_unit ? String(observation.package_unit) : null
      });
    }
  }

  return (products ?? [])
    .filter((product) => !memberProductIds.has(String(product.id)))
    .map((product): ProductCandidate => {
      const latest = latestByProduct.get(String(product.id));

      return {
        id: String(product.id),
        ean: product.ean ? String(product.ean) : null,
        name: String(product.name ?? ""),
        brand: product.brand ? String(product.brand) : null,
        category: product.category ? String(product.category) : null,
        package_size: product.package_size ? String(product.package_size) : null,
        comparison_unit:
          product.comparison_unit
            ? String(product.comparison_unit)
            : latest?.comparison_unit ?? inferredComparisonUnitForProduct(product),
        latest_unit_price: latest?.unit_price ?? null,
        package_quantity: latest?.package_quantity ?? null,
        package_unit: latest?.package_unit ?? null,
        normalized_name: normalizeProductName(product)
      };
    })
    .filter((product) => product.name && product.normalized_name.length >= 2)
    .filter((product) => productMatchesTargetQuery(product, targetQuery));
}

async function insertSuggestion(group: AiGroup, raw: unknown, createdBy: string | null) {
  const supabase = getSupabaseAdmin();

  const { data: suggestion, error: suggestionError } = await supabase
    .from("product_group_suggestions")
    .insert({
      status: "pending",
      suggested_group_name: group.group_name,
      brand: group.brand,
      category: group.category,
      comparison_unit: group.comparison_unit,
      confidence: group.confidence,
      reason: group.reason,
      raw,
      created_by: createdBy
    })
    .select("id")
    .single();

  if (suggestionError) throw suggestionError;

  const members = group.members.map((member) => ({
    suggestion_id: suggestion.id,
    product_id: member.product_id,
    relationship_type: member.relationship_type,
    confidence: member.confidence,
    reason: member.reason
  }));

  if (members.length) {
    const { error: membersError } = await supabase
      .from("product_group_suggestion_members")
      .insert(members);

    if (membersError) throw membersError;
  }

  return suggestion.id as string;
}

export async function POST(request: Request) {
  try {
    const admin = await requireSystemAdmin(request);
    const body = await request.json().catch(() => ({}));

    const limit = Math.min(Math.max(Number(body?.limit ?? 180), 20), 500);
    const maxCandidateSets = Math.min(Math.max(Number(body?.maxCandidateSets ?? 12), 1), 30);
    const onlyUngrouped = body?.onlyUngrouped !== false;
    const targetQuery = cleanText(body?.targetQuery) || null;
    const ignoreNegativeMatches = body?.ignoreNegativeMatches === true;

    const products = await loadProductsForGrouping(limit, onlyUngrouped, targetQuery);
    const blockedPairs = ignoreNegativeMatches
      ? new Set<string>()
      : await loadActiveNegativeMatchKeys(products.map((product) => product.id));
    const candidateSets = buildDeterministicCandidateSets(products, maxCandidateSets, blockedPairs);

    const createdSuggestionIds: string[] = [];
    const skipped: string[] = [];

    for (const candidateSet of candidateSets) {
      const groups = await askAiForGroups(candidateSet);
      if (!groups.length) {
        skipped.push(candidateSet.map((product) => product.name).join(", "));
        continue;
      }

      for (const group of groups) {
        const id = await insertSuggestion(
          group,
          {
            generated_at: new Date().toISOString(),
            candidate_products: candidateSet,
            model: process.env.OPENAI_PRODUCT_GROUP_MODEL || "gpt-4.1-mini",
            mode: process.env.OPENAI_API_KEY ? "ai" : "deterministic-fallback",
            target_query: targetQuery,
            ignore_negative_matches: ignoreNegativeMatches
          },
          admin.userId === "00000000-0000-0000-0000-000000000000" ? null : admin.userId
        );
        createdSuggestionIds.push(id);
      }
    }

    return NextResponse.json({
      createdCount: createdSuggestionIds.length,
      createdSuggestionIds,
      candidateSetCount: candidateSets.length,
      productCount: products.length,
      targetQuery,
      ignoreNegativeMatches,
      blockedPairCount: blockedPairs.size,
      skipped
    });
  } catch (error) {
    console.error("[api/admin/product-groups/suggestions/generate] failed", error);
    return systemAdminErrorResponse(error);
  }
}
