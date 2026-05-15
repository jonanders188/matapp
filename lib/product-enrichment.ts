import { lookupOpenFoodFactsByEan } from "@/lib/open-food-facts";

type SupabaseLike = {
  from: (table: string) => any;
};

export type ProductEnrichmentRow = {
  id: string;
  household_id?: string | null;
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

export type ProductEnrichmentResult = {
  found: boolean;
  updated: boolean;
  productId: string;
  productName: string;
  ean: string;
  updatedFields: string[];
  missingFields: string[];
  images: Record<string, string | null | undefined>;
  message?: string;
};

export const OPEN_FOOD_FACTS_FIELDS = [
  "image_url",
  "brand",
  "package_size",
  "ingredients",
  "allergens",
  "nutrition",
  "labels",
  "category_path",
  "category"
] as const;

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function mergeOnlyMissing<T>(current: T | null | undefined, next: T | null | undefined): T | null {
  if (hasValue(current)) return current as T;
  return next ?? null;
}

function sourceObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function missingOpenFoodFactsFields(product: ProductEnrichmentRow) {
  const missing: string[] = [];

  if (!hasValue(product.image_url)) missing.push("image_url");
  if (!hasValue(product.ingredients)) missing.push("ingredients");
  if (!hasValue(product.allergens)) missing.push("allergens");
  if (!hasValue(product.nutrition)) missing.push("nutrition");
  if (!hasValue(product.labels)) missing.push("labels");
  if (!hasValue(product.category_path)) missing.push("category_path");

  return missing;
}

export function shouldEnrichWithOpenFoodFacts(product: ProductEnrichmentRow) {
  const ean = String(product.ean ?? "").replace(/\D/g, "");
  return Boolean(ean) && missingOpenFoodFactsFields(product).length > 0;
}

function changedFields(before: ProductEnrichmentRow, updatePayload: Record<string, unknown>) {
  return OPEN_FOOD_FACTS_FIELDS.filter((field) => {
    const beforeValue = before[field as keyof ProductEnrichmentRow];
    const afterValue = updatePayload[field];
    return !hasValue(beforeValue) && hasValue(afterValue);
  });
}

export async function enrichProductWithOpenFoodFacts(supabase: SupabaseLike, product: ProductEnrichmentRow): Promise<ProductEnrichmentResult> {
  const ean = String(product.ean ?? "").replace(/\D/g, "");

  if (!ean) {
    return {
      found: false,
      updated: false,
      productId: product.id,
      productName: product.name,
      ean: "",
      updatedFields: [],
      missingFields: missingOpenFoodFactsFields(product),
      images: {},
      message: "Produktet mangler EAN"
    };
  }

  const off = await lookupOpenFoodFactsByEan(ean);

  if (!off.found) {
    return {
      found: false,
      updated: false,
      productId: product.id,
      productName: product.name,
      ean,
      updatedFields: [],
      missingFields: missingOpenFoodFactsFields(product),
      images: {},
      message: "Fant ikke produktet i Open Food Facts"
    };
  }

  const now = new Date().toISOString();
  const existingSources = sourceObject(product.enrichment_sources);
  const existingQuality = sourceObject(product.data_quality);

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
        missing_after: missingOpenFoodFactsFields({
          ...product,
          image_url: mergeOnlyMissing(product.image_url, off.image_url),
          ingredients: mergeOnlyMissing(product.ingredients, off.ingredients),
          allergens: mergeOnlyMissing(product.allergens, off.allergens.length ? off.allergens : null),
          nutrition: mergeOnlyMissing(product.nutrition, off.nutrition),
          labels: mergeOnlyMissing(product.labels, off.labels.length ? off.labels : null),
          category_path: mergeOnlyMissing(product.category_path, off.category_path.length ? off.category_path : null)
        }),
        warning: "Open Food Facts er brukergenerert. Kontroller alltid emballasjen ved allergi."
      }
    }
  };

  const updatedFields = changedFields(product, updatePayload);

  const updateResult = await supabase
    .from("products")
    .update(updatePayload)
    .eq("id", product.id)
    .select("*")
    .single();

  if (updateResult.error) throw updateResult.error;

  return {
    found: true,
    updated: true,
    productId: product.id,
    productName: product.name,
    ean,
    updatedFields,
    missingFields: missingOpenFoodFactsFields(updateResult.data as ProductEnrichmentRow),
    images: off.images,
    message: "Produktdata er beriket fra Open Food Facts. Kontroller emballasjen ved allergi."
  };
}
