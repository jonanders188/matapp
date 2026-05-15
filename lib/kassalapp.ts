export type KassalappStore = {
  name: string;
  code: string;
  url?: string | null;
  logo?: string | null;
};

export type KassalappPriceHistory = {
  price: number;
  date: string;
  store?: string | null;
};

export type KassalappComparisonStore = {
  store?: string | null;
  code?: string | null;
  name?: string | null;
  current_price?: number | null;
  current_unit_price?: number | null;
  last_checked?: string | null;
};

export type KassalappCategory = { id?: number; depth?: number; name: string };

export type KassalappProduct = {
  id: number;
  name: string;
  brand?: string | null;
  vendor?: string | null;
  ean?: string | null;
  url?: string | null;
  image?: string | null;
  category?: KassalappCategory[] | null;
  current_price?: number | null;
  current_unit_price?: number | null;
  weight?: number | null;
  weight_unit?: string | null;
  store?: KassalappStore | null;
  price_history?: KassalappPriceHistory[] | null;
  description?: string | null;
  ingredients?: unknown;
  allergens?: unknown;
  nutrition?: unknown;
  nutrients?: unknown;
  labels?: unknown;
  raw?: unknown;
  kassalapp?: { url?: string | null; image?: string | null; opengraph?: string | null } | null;
};

export type KassalappProductComparison = Partial<KassalappProduct> & {
  ean: string;
  name: string;
  stores?: KassalappComparisonStore[] | null;
  price_history?: KassalappPriceHistory[] | null;
};

export type KassalappSearchResponse = {
  data: KassalappProduct[];
  links?: Record<string, string | null>;
  meta?: Record<string, unknown>;
};

export type ProductMetadataPayload = {
  description: string | null;
  ingredients: string | null;
  allergens: unknown | null;
  nutrition: unknown | null;
  labels: unknown | null;
  category_path: string[] | null;
  kassalapp_raw: unknown | null;
};

const BASE_URL = "https://kassal.app/api/v1";

export function hasKassalappKey() {
  return Boolean(process.env.KASSALAPP_API_KEY);
}

function cleanEan(value: string) {
  return String(value ?? "").replace(/\D/g, "").trim();
}

function looksLikeEan(value: string) {
  const clean = cleanEan(value);
  return clean.length >= 8 && clean.length <= 14 && clean === value.replace(/\s/g, "");
}

function queryValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

async function kassalappFetch<T>(path: string, init?: { searchParams?: Record<string, string | number | boolean | null | undefined>; revalidate?: number }) {
  const apiKey = process.env.KASSALAPP_API_KEY;
  if (!apiKey) {
    throw new Error("KASSALAPP_API_KEY mangler i miljøvariabler");
  }

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(init?.searchParams ?? {})) {
    const normalized = queryValue(value);
    if (normalized !== null) {
      url.searchParams.set(key, normalized);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    },
    next: { revalidate: init?.revalidate ?? 60 * 15 }
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Kassalapp svarte ${response.status}: ${body.slice(0, 500)}`);
  }

  return (await response.json()) as T;
}

async function searchProductsWithParams(query: string, limit: number, searchParams: Record<string, string | number | boolean>) {
  const payload = await kassalappFetch<KassalappSearchResponse>("/products", {
    searchParams: {
      search: query,
      size: Math.min(Math.max(limit, 1), 100),
      ...searchParams
    }
  });

  return payload?.data ?? [];
}

export async function searchKassalappProducts(query: string, limit = 12) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (looksLikeEan(trimmed)) {
    const eanProducts = await findKassalappProductsByEan(trimmed);
    if (eanProducts.length) return eanProducts.slice(0, limit);
  }

  // Kassalapp dokumenterer exclude_without_ean og unique som boolean-parametere.
  // Noen miljøer har likevel svart med valideringsfeil på boolske queryverdier,
  // så vi prøver dokumentert format først, deretter 0/1, og til slutt uten disse.
  try {
    return await searchProductsWithParams(trimmed, limit, {
      exclude_without_ean: false,
      unique: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/exclude_without_ean|unique|true or false|boolean/i.test(message)) throw error;
  }

  try {
    return await searchProductsWithParams(trimmed, limit, {
      exclude_without_ean: 0,
      unique: 0
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/exclude_without_ean|unique|true or false|boolean/i.test(message)) throw error;
  }

  return searchProductsWithParams(trimmed, limit, {});
}

export async function lookupKassalappProductByEan(ean: string) {
  const clean = cleanEan(ean);
  if (!clean) return null;

  const payload = await kassalappFetch<{ data?: KassalappProductComparison }>(`/products/ean/${encodeURIComponent(clean)}`);
  return payload?.data ?? null;
}

export function productsFromEanComparison(comparison: KassalappProductComparison): { selected: KassalappProduct; related: KassalappProduct[] } {
  const ean = String(comparison.ean ?? "");
  const stores = comparison.stores ?? [];
  const history = comparison.price_history ?? [];

  const related = stores
    .filter((store) => store.current_price != null)
    .map((store, index) => {
      const storeCode = store.store ?? store.code ?? store.name ?? "UNKNOWN";
      const latestHistory = history.find((entry) => entry.store === storeCode);

      return {
        ...comparison,
        id: Number(comparison.id ?? index + 1),
        name: comparison.name,
        brand: comparison.brand ?? null,
        vendor: comparison.vendor ?? null,
        ean,
        url: comparison.url ?? comparison.kassalapp?.url ?? null,
        image: comparison.image ?? comparison.kassalapp?.image ?? null,
        category: comparison.category ?? null,
        current_price: store.current_price ?? null,
        current_unit_price: store.current_unit_price ?? null,
        weight: comparison.weight ?? null,
        weight_unit: comparison.weight_unit ?? null,
        store: {
          name: store.name ?? storeCode,
          code: storeCode
        },
        price_history: [
          {
            price: store.current_price ?? 0,
            date: store.last_checked ?? latestHistory?.date ?? new Date().toISOString(),
            store: storeCode
          }
        ]
      } satisfies KassalappProduct;
    });

  const selected = related[0] ?? {
    ...comparison,
    id: Number(comparison.id ?? 0),
    name: comparison.name,
    brand: comparison.brand ?? null,
    vendor: comparison.vendor ?? null,
    ean,
    url: comparison.url ?? comparison.kassalapp?.url ?? null,
    image: comparison.image ?? comparison.kassalapp?.image ?? null,
    category: comparison.category ?? null,
    current_price: comparison.current_price ?? null,
    current_unit_price: comparison.current_unit_price ?? null,
    weight: comparison.weight ?? null,
    weight_unit: comparison.weight_unit ?? null,
    store: comparison.store ?? null,
    price_history: comparison.price_history ?? null
  };

  return { selected, related: related.length ? related : [selected] };
}

export async function lookupKassalappProductsWithPricesByEan(ean: string) {
  const products = await findKassalappProductsByEan(ean);
  if (products.length) return { selected: products[0], related: products };

  const comparison = await lookupKassalappProductByEan(ean);
  if (!comparison) return null;
  return productsFromEanComparison(comparison);
}

export function categoryPath(product: Pick<KassalappProduct, "category">) {
  const categories = product.category ?? [];
  const names = [...categories]
    .sort((a, b) => Number(a.depth ?? 0) - Number(b.depth ?? 0))
    .map((category) => category.name)
    .filter(Boolean);
  return names.length ? names : null;
}

export function normalizeCategory(product: KassalappProduct) {
  const path = categoryPath(product);
  return path?.at(-1) ?? null;
}

export function packageSize(product: KassalappProduct) {
  if (product.weight && product.weight_unit) return `${product.weight} ${product.weight_unit}`;
  if (product.weight) return String(product.weight);
  return null;
}

export function latestPriceDate(product: KassalappProduct) {
  return product.price_history?.[0]?.date ?? null;
}

function toNumberOrNull(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getPath(value: any, paths: string[][]) {
  for (const path of paths) {
    let current = value;
    for (const key of path) current = current?.[key];
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return null;
}

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => (typeof item === "string" ? item : item?.name ?? item?.text ?? item?.value ?? null))
      .filter(Boolean)
      .join(", ")
      .trim();
    return text || null;
  }
  if (value && typeof value === "object") {
    const text = Object.values(value as Record<string, unknown>)
      .map((item) => (typeof item === "string" ? item : null))
      .filter(Boolean)
      .join(", ")
      .trim();
    return text || null;
  }
  return null;
}

function normalizeJson(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

export function productMetadataPayload(product: KassalappProduct): ProductMetadataPayload {
  const raw = (product as any).raw ?? product;
  const description = normalizeText(
    getPath(product, [["description"], ["kassalapp", "description"], ["metadata", "description"]])
  );
  const ingredients = normalizeText(
    getPath(product, [["ingredients"], ["ingredient_list"], ["ingredients_text"], ["metadata", "ingredients"]])
  );
  const allergens = normalizeJson(
    getPath(product, [["allergens"], ["allergy"], ["metadata", "allergens"]])
  );
  const nutrition = normalizeJson(
    getPath(product, [["nutrition"], ["nutrients"], ["nutrition_facts"], ["nutritional_info"], ["metadata", "nutrition"]])
  );
  const labels = normalizeJson(
    getPath(product, [["labels"], ["label"], ["tags"], ["metadata", "labels"]])
  );

  return {
    description,
    ingredients,
    allergens,
    nutrition,
    labels,
    category_path: categoryPath(product),
    kassalapp_raw: raw
  };
}

function priceDateFromAny(value: any) {
  return value?.date ?? value?.valid_from ?? value?.updated_at ?? value?.created_at ?? null;
}

function storeCode(store: any) {
  return String(store?.code ?? store?.store ?? store?.name ?? "UNKNOWN");
}

function storeName(store: any) {
  return String(store?.name ?? store?.store ?? store?.code ?? "Ukjent butikk");
}

function kassalappStoreProductsFromEanPayload(payload: any, fallbackEan: string): KassalappProduct[] {
  const root = payload?.data ?? payload;

  const products = Array.isArray(root?.products)
    ? root.products
    : Array.isArray(root)
      ? root
      : root?.product
        ? [root.product]
        : root
          ? [root]
          : [];

  const result: KassalappProduct[] = [];

  for (const product of products) {
    const stores = asArray(product?.store ?? product?.stores);
    const prices = asArray(product?.current_price ?? product?.prices);

    if (stores.length && prices.length) {
      for (let index = 0; index < stores.length; index += 1) {
        const store = stores[index];
        const priceObject = prices[index] ?? prices[0];
        const price = toNumberOrNull(typeof priceObject === "object" ? priceObject?.price ?? priceObject?.current_price : priceObject);
        if (price == null) continue;

        const unitPrice = toNumberOrNull(
          typeof priceObject === "object"
            ? priceObject?.unit_price ?? priceObject?.current_unit_price ?? priceObject?.unitPrice
            : product?.current_unit_price
        );
        const date = typeof priceObject === "object" ? priceDateFromAny(priceObject) : null;

        result.push({
          ...product,
          raw: product,
          id: Number(product?.id ?? product?.kassalapp_id ?? 0),
          name: String(product?.name ?? product?.product_name ?? "Ukjent produkt"),
          brand: product?.brand ?? product?.vendor ?? null,
          vendor: product?.vendor ?? null,
          ean: String(product?.ean ?? root?.ean ?? fallbackEan),
          url: product?.url ?? product?.kassalapp?.url ?? null,
          image: product?.image ?? product?.image_url ?? product?.kassalapp?.image ?? product?.kassalapp?.opengraph ?? null,
          category: product?.category ?? null,
          current_price: price,
          current_unit_price: unitPrice,
          weight: product?.weight ?? null,
          weight_unit: product?.weight_unit ?? null,
          store: {
            ...store,
            code: storeCode(store),
            name: storeName(store)
          },
          price_history: date ? [{ price, date, store: storeCode(store) }] : product?.price_history ?? []
        });
      }

      continue;
    }

    const price = toNumberOrNull(product?.current_price);
    result.push({
      ...product,
      raw: product,
      id: Number(product?.id ?? product?.kassalapp_id ?? 0),
      name: String(product?.name ?? product?.product_name ?? "Ukjent produkt"),
      brand: product?.brand ?? product?.vendor ?? null,
      vendor: product?.vendor ?? null,
      ean: String(product?.ean ?? root?.ean ?? fallbackEan),
      url: product?.url ?? product?.kassalapp?.url ?? null,
      image: product?.image ?? product?.image_url ?? product?.kassalapp?.image ?? product?.kassalapp?.opengraph ?? null,
      category: product?.category ?? null,
      current_price: price,
      current_unit_price: toNumberOrNull(product?.current_unit_price),
      weight: product?.weight ?? null,
      weight_unit: product?.weight_unit ?? null,
      store: product?.store
        ? {
            ...(Array.isArray(product.store) ? product.store[0] : product.store),
            code: storeCode(Array.isArray(product.store) ? product.store[0] : product.store),
            name: storeName(Array.isArray(product.store) ? product.store[0] : product.store)
          }
        : null,
      price_history: product?.price_history ?? []
    });
  }

  return result.filter((product) => product.id && product.name);
}

export async function findKassalappProductsByEan(ean: string) {
  const clean = cleanEan(ean);
  if (!clean) return [] as KassalappProduct[];

  const payload = await kassalappFetch<any>(`/products/ean/${encodeURIComponent(clean)}`);
  if (!payload) return [] as KassalappProduct[];

  return kassalappStoreProductsFromEanPayload(payload, clean);
}
