export type OpenFoodFactsImageSet = {
  front?: string | null;
  ingredients?: string | null;
  nutrition?: string | null;
  packaging?: string | null;
};

export type NormalizedOpenFoodFactsProduct = {
  found: boolean;
  source: "openfoodfacts";
  code: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  quantity: string | null;
  ingredients: string | null;
  allergens: string[];
  nutrition: Record<string, unknown> | null;
  labels: string[];
  category_path: string[];
  images: OpenFoodFactsImageSet;
  raw: unknown | null;
};

type OffSelectedImage = {
  display?: Record<string, string>;
  small?: Record<string, string>;
  thumb?: Record<string, string>;
};

type OffProduct = {
  code?: string;
  product_name?: string;
  product_name_no?: string;
  product_name_nb?: string;
  generic_name?: string;
  brands?: string;
  image_url?: string;
  image_front_url?: string;
  image_ingredients_url?: string;
  image_nutrition_url?: string;
  image_packaging_url?: string;
  quantity?: string;
  ingredients_text?: string;
  ingredients_text_no?: string;
  ingredients_text_nb?: string;
  allergens_tags?: string[];
  nutriments?: Record<string, unknown>;
  labels_tags?: string[];
  categories_tags?: string[];
  selected_images?: Record<string, OffSelectedImage>;
};

type OffResponse = {
  status?: number;
  status_verbose?: string;
  code?: string;
  product?: OffProduct;
};

const OFF_BASE_URL = "https://world.openfoodfacts.org/api/v2/product";
const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_no",
  "product_name_nb",
  "generic_name",
  "brands",
  "image_url",
  "image_front_url",
  "image_ingredients_url",
  "image_nutrition_url",
  "image_packaging_url",
  "quantity",
  "ingredients_text",
  "ingredients_text_no",
  "ingredients_text_nb",
  "allergens_tags",
  "nutriments",
  "labels_tags",
  "categories_tags",
  "selected_images"
].join(",");

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function cleanTag(value: string) {
  return value
    .replace(/^[a-z]{2}:/i, "")
    .replace(/-/g, " ")
    .trim();
}

function cleanTags(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => cleanTag(String(value))).filter(Boolean);
}

function pickLocalizedImage(image?: OffSelectedImage | null) {
  if (!image) return null;
  return (
    image.display?.no ??
    image.display?.nb ??
    image.display?.en ??
    Object.values(image.display ?? {})[0] ??
    image.small?.no ??
    image.small?.nb ??
    image.small?.en ??
    Object.values(image.small ?? {})[0] ??
    image.thumb?.no ??
    image.thumb?.nb ??
    image.thumb?.en ??
    Object.values(image.thumb ?? {})[0] ??
    null
  );
}

function imageSet(product: OffProduct): OpenFoodFactsImageSet {
  return {
    front: product.image_front_url ?? pickLocalizedImage(product.selected_images?.front) ?? product.image_url ?? null,
    ingredients: product.image_ingredients_url ?? pickLocalizedImage(product.selected_images?.ingredients) ?? null,
    nutrition: product.image_nutrition_url ?? pickLocalizedImage(product.selected_images?.nutrition) ?? null,
    packaging: product.image_packaging_url ?? pickLocalizedImage(product.selected_images?.packaging) ?? null
  };
}

export async function lookupOpenFoodFactsByEan(ean: string): Promise<NormalizedOpenFoodFactsProduct> {
  const cleanEan = String(ean ?? "").replace(/\D/g, "");
  if (!cleanEan) {
    return {
      found: false,
      source: "openfoodfacts",
      code: "",
      name: null,
      brand: null,
      image_url: null,
      quantity: null,
      ingredients: null,
      allergens: [],
      nutrition: null,
      labels: [],
      category_path: [],
      images: {},
      raw: null
    };
  }

  const url = new URL(`${OFF_BASE_URL}/${encodeURIComponent(cleanEan)}.json`);
  url.searchParams.set("fields", OFF_FIELDS);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "matapp-husholdningspilot/0.1 (Open Food Facts enrichment)"
    },
    next: { revalidate: 60 * 60 * 24 }
  });

  if (!response.ok) {
    throw new Error(`Open Food Facts svarte ${response.status}`);
  }

  const payload = (await response.json()) as OffResponse;
  const product = payload.product;

  if (payload.status !== 1 || !product) {
    return {
      found: false,
      source: "openfoodfacts",
      code: cleanEan,
      name: null,
      brand: null,
      image_url: null,
      quantity: null,
      ingredients: null,
      allergens: [],
      nutrition: null,
      labels: [],
      category_path: [],
      images: {},
      raw: payload
    };
  }

  const images = imageSet(product);
  const ingredients = cleanText(product.ingredients_text_no) ?? cleanText(product.ingredients_text_nb) ?? cleanText(product.ingredients_text);

  return {
    found: true,
    source: "openfoodfacts",
    code: product.code ?? cleanEan,
    name: cleanText(product.product_name_no) ?? cleanText(product.product_name_nb) ?? cleanText(product.product_name) ?? cleanText(product.generic_name),
    brand: cleanText(product.brands),
    image_url: images.front ?? product.image_url ?? null,
    quantity: cleanText(product.quantity),
    ingredients,
    allergens: cleanTags(product.allergens_tags),
    nutrition: product.nutriments && Object.keys(product.nutriments).length ? product.nutriments : null,
    labels: cleanTags(product.labels_tags),
    category_path: cleanTags(product.categories_tags),
    images,
    raw: payload
  };
}
