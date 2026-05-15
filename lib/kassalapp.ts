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

export type KassalappProduct = {
  id: number;
  name: string;
  brand?: string | null;
  vendor?: string | null;
  ean?: string | null;
  url?: string | null;
  image?: string | null;
  category?: Array<{ id: number; depth: number; name: string }> | null;
  current_price?: number | null;
  current_unit_price?: number | null;
  weight?: number | null;
  weight_unit?: string | null;
  store?: KassalappStore | null;
  price_history?: KassalappPriceHistory[] | null;
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

const BASE_URL = "https://kassal.app/api/v1";

export function hasKassalappKey() {
  return Boolean(process.env.KASSALAPP_API_KEY);
}

async function kassalappFetch<T>(path: string, init?: { searchParams?: Record<string, string | number | boolean | null | undefined>; revalidate?: number }) {
  const apiKey = process.env.KASSALAPP_API_KEY;
  if (!apiKey) {
    throw new Error("KASSALAPP_API_KEY mangler i miljøvariabler");
  }

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(init?.searchParams ?? {})) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
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
    throw new Error(`Kassalapp svarte ${response.status}: ${body.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

export async function searchKassalappProducts(query: string, limit = 12) {
  const payload = await kassalappFetch<KassalappSearchResponse>("/products", {
    searchParams: {
      search: query,
      size: Math.min(Math.max(limit, 1), 100),
      exclude_without_ean: false,
      unique: false
    }
  });

  return payload?.data ?? [];
}

export async function lookupKassalappProductByEan(ean: string) {
  const cleanEan = String(ean ?? "").replace(/\D/g, "");
  if (!cleanEan) return null;

  const payload = await kassalappFetch<{ data?: KassalappProductComparison }>(`/products/ean/${encodeURIComponent(cleanEan)}`);
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
        id: Number(comparison.id ?? index + 1),
        name: comparison.name,
        brand: comparison.brand ?? null,
        vendor: comparison.vendor ?? null,
        ean,
        url: comparison.url ?? null,
        image: comparison.image ?? null,
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
    id: Number(comparison.id ?? 0),
    name: comparison.name,
    brand: comparison.brand ?? null,
    vendor: comparison.vendor ?? null,
    ean,
    url: comparison.url ?? null,
    image: comparison.image ?? null,
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
  const comparison = await lookupKassalappProductByEan(ean);
  if (!comparison) return null;
  return productsFromEanComparison(comparison);
}

export function normalizeCategory(product: KassalappProduct) {
  const categories = product.category ?? [];
  const leaf = [...categories].sort((a, b) => b.depth - a.depth)[0];
  return leaf?.name ?? null;
}

export function packageSize(product: KassalappProduct) {
  if (product.weight && product.weight_unit) return `${product.weight} ${product.weight_unit}`;
  if (product.weight) return String(product.weight);
  return null;
}

export function latestPriceDate(product: KassalappProduct) {
  return product.price_history?.[0]?.date ?? null;
}


type KassalappComparisonPrice = {
  price?: number | null;
  unit_price?: number | null;
  date?: string | null;
};

type KassalappComparisonProduct = Omit<KassalappProduct, "id" | "store" | "current_price" | "current_unit_price"> & {
  id: string | number;
  store?: KassalappStore[] | KassalappStore | null;
  current_price?: KassalappComparisonPrice[] | number | null;
  current_unit_price?: number | null;
  kassalapp?: { url?: string | null; opengraph?: string | null } | null;
};

type KassalappEanResponse = {
  data?: {
    ean?: string | null;
    products?: KassalappComparisonProduct[];
  };
};

function toNumberOrNull(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStoreList(value: KassalappComparisonProduct["store"]) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizePriceList(value: KassalappComparisonProduct["current_price"]) {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value;
  }

  return [
    {
      price: value,
      unit_price: null,
      date: null
    }
  ];
}

function comparisonProductToStoreProducts(
  comparisonProduct: KassalappComparisonProduct,
  fallbackEan: string
): KassalappProduct[] {
  const stores = normalizeStoreList(comparisonProduct.store);
  const prices = normalizePriceList(comparisonProduct.current_price);

  if (!stores.length || !prices.length) {
    return [];
  }

  return stores.flatMap((store, index) => {
    const price = prices[index] ?? prices[0];
    const currentPrice = toNumberOrNull(price?.price);

    if (currentPrice == null) {
      return [];
    }

    const currentUnitPrice = toNumberOrNull(price?.unit_price);
    const priceDate = price?.date ?? null;

    return [
      {
        ...comparisonProduct,
        id: Number(comparisonProduct.id),
        ean: comparisonProduct.ean ?? fallbackEan,
        url: comparisonProduct.url ?? comparisonProduct.kassalapp?.url ?? null,
        store,
        current_price: currentPrice,
        current_unit_price: currentUnitPrice,
        price_history: priceDate
          ? [
              {
                price: currentPrice,
                date: priceDate
              }
            ]
          : comparisonProduct.price_history ?? []
      }
    ];
  });
}


function kassalappNumberOrNull(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function kassalappArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function kassalappPriceDateFromAny(value: any) {
  return value?.date ?? value?.valid_from ?? value?.updated_at ?? value?.created_at ?? null;
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
    const stores = kassalappArray(product?.store);
    const prices = kassalappArray(product?.current_price);

    if (stores.length && prices.length) {
      for (let index = 0; index < stores.length; index += 1) {
        const store = stores[index];
        const priceObject = prices[index] ?? prices[0];

        const price = kassalappNumberOrNull(
          typeof priceObject === "object" ? priceObject?.price : priceObject
        );

        if (price == null) continue;

        const unitPrice = kassalappNumberOrNull(
          typeof priceObject === "object"
            ? priceObject?.unit_price ?? priceObject?.unitPrice
            : product?.current_unit_price
        );

        const date = typeof priceObject === "object" ? kassalappPriceDateFromAny(priceObject) : null;

        result.push({
          ...product,
          id: Number(product?.id ?? product?.kassalapp_id ?? 0),
          name: String(product?.name ?? product?.product_name ?? "Ukjent produkt"),
          brand: product?.brand ?? product?.vendor ?? null,
          vendor: product?.vendor ?? null,
          ean: String(product?.ean ?? root?.ean ?? fallbackEan),
          url: product?.url ?? product?.kassalapp?.url ?? null,
          image: product?.image ?? product?.image_url ?? product?.kassalapp?.image ?? null,
          category: product?.category ?? null,
          current_price: price,
          current_unit_price: unitPrice,
          weight: product?.weight ?? null,
          weight_unit: product?.weight_unit ?? null,
          store: store ?? null,
          price_history: date ? [{ price, date }] : product?.price_history ?? []
        });
      }

      continue;
    }

    const price = kassalappNumberOrNull(product?.current_price);
    if (price == null) continue;

    result.push({
      ...product,
      id: Number(product?.id ?? product?.kassalapp_id ?? 0),
      name: String(product?.name ?? product?.product_name ?? "Ukjent produkt"),
      brand: product?.brand ?? product?.vendor ?? null,
      vendor: product?.vendor ?? null,
      ean: String(product?.ean ?? root?.ean ?? fallbackEan),
      url: product?.url ?? product?.kassalapp?.url ?? null,
      image: product?.image ?? product?.image_url ?? product?.kassalapp?.image ?? null,
      category: product?.category ?? null,
      current_price: price,
      current_unit_price: kassalappNumberOrNull(product?.current_unit_price),
      weight: product?.weight ?? null,
      weight_unit: product?.weight_unit ?? null,
      store: product?.store ?? null,
      price_history: product?.price_history ?? []
    });
  }

  return result.filter((product) => product.id && product.name);
}

export async function findKassalappProductsByEan(ean: string) {
  const apiKey = process.env.KASSALAPP_API_KEY;

  if (!apiKey) {
    throw new Error("KASSALAPP_API_KEY mangler i miljøvariabler");
  }

  const cleanEan = String(ean ?? "").replace(/\D/g, "").trim();

  if (!cleanEan) {
    return [] as KassalappProduct[];
  }

  const response = await fetch(
    `${BASE_URL}/products/ean/${encodeURIComponent(cleanEan)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      },
      next: { revalidate: 60 * 15 }
    }
  );

  if (response.status === 404) {
    return [] as KassalappProduct[];
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Kassalapp EAN-oppslag svarte ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const payload = await response.json();
  return kassalappStoreProductsFromEanPayload(payload, cleanEan);
}

