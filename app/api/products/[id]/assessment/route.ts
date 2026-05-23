import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductRow = Record<string, unknown> & {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  ingredients?: string | null;
  allergens?: unknown | null;
  nutrition?: unknown | null;
  labels?: unknown | null;
  category_path?: string[] | null;
};

type HouseholdProductRow = {
  is_basis: boolean | null;
  desired_stock: number | null;
  target_price: number | null;
  target_price_unit: string | null;
  preferred_store: string | null;
  is_freezable: boolean | null;
  notes: string | null;
};

type PriceObservationRow = {
  store_code: string | null;
  store_name: string | null;
  price: number | null;
  unit_price: number | null;
  observed_at: string | null;
  source: string | null;
};

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

function asNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function latestPrice(observations: PriceObservationRow[]) {
  return observations.find((observation) => asNumber(observation.price) !== null) ?? null;
}

function normalizeNutrition(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function pickNutrition(nutrition: Record<string, unknown> | null, keys: string[]) {
  if (!nutrition) return null;
  for (const key of keys) {
    const value = asNumber(nutrition[key]);
    if (value !== null) return value;
  }
  return null;
}

function nutritionFacts(product: ProductRow) {
  const nutrition = normalizeNutrition(product.nutrition);
  const energyKcal = pickNutrition(nutrition, ["energy-kcal_100g", "energy-kcal", "calories", "kcal", "energy_kcal"]);
  const protein = pickNutrition(nutrition, ["proteins_100g", "protein_100g", "protein_g", "protein"]);
  const proteinPer100Kcal = energyKcal && protein ? Number(((protein / energyKcal) * 100).toFixed(1)) : null;

  return {
    energy_kcal: energyKcal,
    fat_g: pickNutrition(nutrition, ["fat_100g", "fat_g", "fat"]),
    saturated_fat_g: pickNutrition(nutrition, ["saturated-fat_100g", "saturated_fat_g", "saturated_fat"]),
    carbs_g: pickNutrition(nutrition, ["carbohydrates_100g", "carbs_g", "carbohydrates"]),
    sugars_g: pickNutrition(nutrition, ["sugars_100g", "sugars_g", "sugars"]),
    fiber_g: pickNutrition(nutrition, ["fiber_100g", "fiber_g", "fiber"]),
    protein_g: protein,
    salt_g: pickNutrition(nutrition, ["salt_100g", "salt_g", "salt"]),
    protein_per_100kcal_g: proteinPer100Kcal
  };
}

function compactPriceHistory(observations: PriceObservationRow[]) {
  return observations.slice(0, 12).map((observation) => ({
    store: observation.store_name,
    price_nok: observation.price,
    unit_price: observation.unit_price,
    observed_at: observation.observed_at,
    source: observation.source
  }));
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "null";
  }
}

const assessmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    product: { type: "string" },
    brand: { type: "string" },
    ean: { type: "string" },
    category: { type: "string" },
    type: { type: "string" },
    image_url: { type: "string" },
    allergens: { type: "array", items: { type: "string" } },
    contains_milk_protein: { type: "string", enum: ["ja", "nei", "ukjent"] },
    contains_gluten: { type: "string", enum: ["ja", "nei", "ukjent"] },
    contains_egg: { type: "string", enum: ["ja", "nei", "ukjent"] },
    contains_lactose: { type: "string", enum: ["ja", "nei", "lite", "ukjent"] },
    contains_nuts: { type: "string", enum: ["ja", "nei", "spor", "ukjent"] },
    contains_soy: { type: "string", enum: ["ja", "nei", "spor", "ukjent"] },
    organic: { type: "string", enum: ["ja", "nei", "ukjent"] },
    origin: { type: "string" },
    ingredients: { type: "string" },
    e_additives_count: { type: "number" },
    e_additives: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      code: { type: "string" }, name: { type: "string" }, type: { type: "string" }, risk_level: { type: "string", enum: ["lav", "moderat", "høy", "ukjent"] }, explanation: { type: "string" }
    }, required: ["code", "name", "type", "risk_level", "explanation"] } },
    processing_level: { type: "string", enum: ["minimalt prosessert", "prosessert", "ultraprosessert", "ukjent"] },
    nova_class: { type: "string", enum: ["1", "2", "3", "4", "ukjent"] },
    nutrition_per_100g: { type: "object", additionalProperties: false, properties: {
      energy_kcal: { type: ["number", "null"] }, fat_g: { type: ["number", "null"] }, saturated_fat_g: { type: ["number", "null"] }, carbs_g: { type: ["number", "null"] }, sugars_g: { type: ["number", "null"] }, fiber_g: { type: ["number", "null"] }, protein_g: { type: ["number", "null"] }, salt_g: { type: ["number", "null"] }, protein_per_100kcal_g: { type: ["number", "null"] }
    }, required: ["energy_kcal", "fat_g", "saturated_fat_g", "carbs_g", "sugars_g", "fiber_g", "protein_g", "salt_g", "protein_per_100kcal_g"] },
    price: { type: "object", additionalProperties: false, properties: { price_nok: { type: ["number", "null"] }, price_per_kg_l: { type: ["number", "null"] }, source: { type: "string" } }, required: ["price_nok", "price_per_kg_l", "source"] },
    health_score: { type: "number" },
    health_score_label: { type: "string" },
    value_score: { type: "number" },
    value_score_label: { type: "string" },
    use_frequency: { type: "string", enum: ["daglig", "ofte", "av og til", "sjelden", "ukjent"] },
    quick_badges: { type: "array", items: { type: "string" } },
    pros: { type: "array", items: { type: "string" } },
    cons: { type: "array", items: { type: "string" } },
    important_notes: { type: "array", items: { type: "string" } },
    better_alternatives: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, reason: { type: "string" }, health_score: { type: ["number", "null"] } }, required: ["name", "reason", "health_score"] } },
    short_summary: { type: "string" },
    long_summary: { type: "string" },
    confidence: { type: "number" },
    missing_data: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" } }
  },
  required: ["product", "brand", "ean", "category", "type", "image_url", "allergens", "contains_milk_protein", "contains_gluten", "contains_egg", "contains_lactose", "contains_nuts", "contains_soy", "organic", "origin", "ingredients", "e_additives_count", "e_additives", "processing_level", "nova_class", "nutrition_per_100g", "price", "health_score", "health_score_label", "value_score", "value_score_label", "use_frequency", "quick_badges", "pros", "cons", "important_notes", "better_alternatives", "short_summary", "long_summary", "confidence", "missing_data", "sources"]
};

async function callFoodAi(input: unknown) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY mangler." };

  const model = process.env.OPENAI_FOOD_MODEL || process.env.OPENAI_RECEIPT_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_output_tokens: 7000,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text:
            "Du er en norsk AI-matvarevurderer for dagligvarer. Svar kun med gyldig JSON etter schema. " +
            "Skill tydelig mellom faktadata og vurdering. Ikke gjett sikkert: bruk ukjent/ikke oppgitt/null når data mangler. " +
            "Vurderingen er veiledende, ikke medisinsk rådgivning. Skriv enkelt, praktisk og lettlest norsk. " +
            "Produktet kan være ost, kjøtt, fisk, frukt, grønnsaker, ferdigmat, snacks, drikke, brød, sauser eller tørrvarer. " +
            "Bruk ingredienser, næring per 100 g, allergener, pris og kategori når de finnes. Pris/nytte-score skal vurdere næring og pris, ikke bare lav pris. " +
            "For allergener må melk, gluten, egg, laktose, nøtter og soya være konservativt vurdert. " +
            "Bedre alternativer skal være konkrete hvis kandidatlisten gir grunnlag; ellers generiske men ærlige." }]
        },
        { role: "user", content: [{ type: "input_text", text: `Vurder dette produktet. Produktdata: ${safeJson(input)}` }] }
      ],
      text: { format: { type: "json_schema", name: "food_product_assessment", strict: true, schema: assessmentSchema } }
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "AI-vurdering feilet.";
    return { error: message, status: response.status };
  }

  return { data: JSON.parse(parseOpenAiOutput(payload)) };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { householdId } = await requireCurrentHousehold(request);
    const supabase = getSupabaseAdmin();

    const productResult = await supabase.from("products").select("*").eq("id", id).limit(1);
    if (productResult.error) throw productResult.error;

    const product = productResult.data?.[0] as ProductRow | undefined;
    if (!product) return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });

    const householdResult = await supabase
      .from("household_products")
      .select("is_basis, desired_stock, target_price, target_price_unit, preferred_store, is_freezable, notes")
      .eq("household_id", householdId)
      .eq("product_id", id)
      .limit(1);

    if (householdResult.error) throw householdResult.error;
    const householdProduct = (householdResult.data?.[0] ?? null) as HouseholdProductRow | null;

    const pricesResult = await supabase
      .from("price_observations")
      .select("store_code, store_name, price, unit_price, observed_at, source")
      .eq("product_id", id)
      .gt("price", 0)
      .order("observed_at", { ascending: false })
      .limit(30);

    if (pricesResult.error) throw pricesResult.error;
    const prices = (pricesResult.data ?? []) as PriceObservationRow[];
    const latest = latestPrice(prices);

    const alternativesQuery = product.category
      ? supabase.from("products").select("id, name, brand, category, package_size, image_url").eq("category", product.category).neq("id", id).limit(8)
      : supabase.from("products").select("id, name, brand, category, package_size, image_url").neq("id", id).limit(8);

    const alternativesResult = await alternativesQuery;
    if (alternativesResult.error) throw alternativesResult.error;

    const facts = {
      product: {
        id: product.id,
        name: product.name ?? "ikke oppgitt",
        brand: product.brand ?? "ikke oppgitt",
        ean: product.ean ?? "ikke oppgitt",
        category: product.category ?? "ikke oppgitt",
        package_size: product.package_size ?? "ikke oppgitt",
        image_url: product.image_url ?? "",
        ingredients: product.ingredients ?? "ikke oppgitt",
        allergens: product.allergens ?? [],
        labels: product.labels ?? [],
        category_path: product.category_path ?? [],
        nutrition_per_100g: nutritionFacts(product)
      },
      household: {
        is_basis: Boolean(householdProduct?.is_basis),
        target_price: householdProduct?.target_price ?? null,
        target_price_unit: householdProduct?.target_price_unit ?? null,
        preferred_store: householdProduct?.preferred_store ?? null,
        desired_stock: householdProduct?.desired_stock ?? null
      },
      price: {
        latest_price_nok: latest?.price ?? null,
        latest_unit_price: latest?.unit_price ?? null,
        latest_store: latest?.store_name ?? null,
        latest_source: latest?.source ?? null,
        recent_observations: compactPriceHistory(prices)
      },
      possible_alternatives: alternativesResult.data ?? []
    };

    const ai = await callFoodAi(facts);
    if ("error" in ai) {
      return NextResponse.json({ error: ai.error }, { status: Number(ai.status ?? 503) });
    }

    return NextResponse.json({ data: { assessment: ai.data, facts, generatedAt: new Date().toISOString() } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
