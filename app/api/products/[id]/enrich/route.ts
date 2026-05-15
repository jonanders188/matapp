import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { lookupOpenFoodFactsByEan } from "@/lib/open-food-facts";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ProductRow = {
  id: string;
  household_id: string | null;
  ean: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  ingredients: string | null;
  allergens: unknown | null;
  nutrition: unknown | null;
  labels: unknown | null;
  category_path: string[] | null;
  openfoodfacts_raw?: unknown | null;
  enrichment_sources?: Record<string, unknown> | null;
  data_quality?: Record<string, unknown> | null;
};

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function mergeOnlyMissing<T>(current: T | null | undefined, next: T | null | undefined) {
  return hasValue(current) ? current : next ?? current ?? null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { householdId } = await requireCurrentHousehold(request);
    const supabase = getSupabaseAdmin();

    const productResult = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .limit(1);

    if (productResult.error) throw productResult.error;
    const product = productResult.data?.[0] as ProductRow | undefined;

    if (!product) {
      return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });
    }

    const productBelongsToHousehold = product.household_id === householdId;

    let householdProductExists = false;
    if (!productBelongsToHousehold) {
      const householdProductResult = await supabase
        .from("household_products")
        .select("id")
        .eq("household_id", householdId)
        .eq("product_id", id)
        .limit(1);

      if (householdProductResult.error) throw householdProductResult.error;
      householdProductExists = Boolean(householdProductResult.data?.[0]);
    }

    if (!productBelongsToHousehold && !householdProductExists) {
      return NextResponse.json({ error: "Produktet er ikke koblet til husholdningen" }, { status: 404 });
    }

    const ean = String(product.ean ?? "").replace(/\D/g, "");
    if (!ean) {
      return NextResponse.json({ error: "Produktet mangler EAN" }, { status: 400 });
    }

    const off = await lookupOpenFoodFactsByEan(ean);
    if (!off.found) {
      return NextResponse.json({ found: false, message: "Fant ikke produktet i Open Food Facts" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const existingSources = product.enrichment_sources && typeof product.enrichment_sources === "object" ? product.enrichment_sources : {};
    const existingQuality = product.data_quality && typeof product.data_quality === "object" ? product.data_quality : {};

    const updatePayload = {
      name: product.name || off.name || product.name,
      brand: mergeOnlyMissing(product.brand, off.brand),
      package_size: mergeOnlyMissing(product.package_size, off.quantity),
      image_url: mergeOnlyMissing(product.image_url, off.image_url),
      ingredients: mergeOnlyMissing(product.ingredients, off.ingredients),
      allergens: mergeOnlyMissing(product.allergens, off.allergens.length ? off.allergens : null),
      nutrition: mergeOnlyMissing(product.nutrition, off.nutrition),
      labels: mergeOnlyMissing(product.labels, off.labels.length ? off.labels : null),
      category_path: mergeOnlyMissing(product.category_path, off.category_path.length ? off.category_path : null),
      category: mergeOnlyMissing(product.category, off.category_path[0] ?? null),
      openfoodfacts_raw: off.raw,
      enrichment_sources: {
        ...existingSources,
        openfoodfacts: {
          fetched_at: now,
          code: off.code,
          images: off.images,
          fields: {
            name: Boolean(off.name),
            brand: Boolean(off.brand),
            image_url: Boolean(off.image_url),
            ingredients: Boolean(off.ingredients),
            allergens: off.allergens.length > 0,
            nutrition: Boolean(off.nutrition),
            labels: off.labels.length > 0,
            category_path: off.category_path.length > 0
          }
        }
      },
      data_quality: {
        ...existingQuality,
        openfoodfacts: {
          fetched_at: now,
          found: true,
          has_ingredients: Boolean(off.ingredients),
          has_allergens: off.allergens.length > 0,
          has_nutrition: Boolean(off.nutrition),
          has_images: Object.values(off.images).some(Boolean),
          warning: "Open Food Facts er brukergenerert. Kontroller alltid emballasjen ved allergi."
        }
      }
    };

    const updateResult = await supabase
      .from("products")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (updateResult.error) throw updateResult.error;

    return NextResponse.json({
      found: true,
      source: "openfoodfacts",
      updated: updateResult.data,
      images: off.images,
      message: "Produktdata er beriket fra Open Food Facts. Kontroller emballasjen ved allergi."
    });
  } catch (error) {
    console.error("[api/products/[id]/enrich] POST", error);
    return apiErrorResponse(error);
  }
}
