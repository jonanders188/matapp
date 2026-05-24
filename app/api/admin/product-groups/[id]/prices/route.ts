import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { inferProductNetContent } from "@/lib/unit-pricing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductRow = {
  id: string;
  ean: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  package_size: string | null;
};

type MemberRow = {
  product_id: string;
  products?: ProductRow | ProductRow[] | null;
};

type PriceObservationRow = {
  id: string;
  product_id: string;
  store_code: string | null;
  store_name: string | null;
  price: number | string | null;
  unit_price: number | string | null;
  comparison_unit: string | null;
  package_quantity: number | string | null;
  package_unit: string | null;
  unit_price_source: string | null;
  observed_at: string | null;
  source: string | null;
};

function firstProduct(value: ProductRow | ProductRow[] | null | undefined): ProductRow | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inferPackageQuantity(product: ProductRow | null, comparisonUnit: string | null) {
  if (!product || !comparisonUnit) return null;

  const inferred = inferProductNetContent({
    name: product.name,
    brand: product.brand,
    category: product.category,
    package_size: product.package_size,
    comparison_unit: comparisonUnit
  });

  if (!inferred || inferred.comparison_unit !== comparisonUnit) return null;
  return inferred.comparison_quantity;
}

function recomputeUnitPrice(price: number | null, product: ProductRow | null, comparisonUnit: string | null) {
  if (price === null || !comparisonUnit) return null;
  const packageQuantity = inferPackageQuantity(product, comparisonUnit);
  if (!packageQuantity || packageQuantity <= 0) return null;

  const unitPrice = price / packageQuantity;
  return Number.isFinite(unitPrice) ? Number(unitPrice.toFixed(2)) : null;
}

function chooseUnitPrice(options: {
  storedUnitPrice: number | null;
  recomputedUnitPrice: number | null;
}) {
  const { storedUnitPrice, recomputedUnitPrice } = options;

  if (recomputedUnitPrice !== null && storedUnitPrice !== null) {
    const diffRatio = Math.abs(storedUnitPrice - recomputedUnitPrice) / Math.max(recomputedUnitPrice, 0.01);

    if (diffRatio > 0.30) {
      return {
        unitPrice: recomputedUnitPrice,
        quality: "recomputed_from_product_package",
        wasCorrected: true
      };
    }

    return {
      unitPrice: storedUnitPrice,
      quality: "stored",
      wasCorrected: false
    };
  }

  if (recomputedUnitPrice !== null) {
    return {
      unitPrice: recomputedUnitPrice,
      quality: "recomputed_from_product_package",
      wasCorrected: false
    };
  }

  return {
    unitPrice: storedUnitPrice,
    quality: storedUnitPrice === null ? "missing" : "stored",
    wasCorrected: false
  };
}

function ageWeight(observedAt: string | null) {
  if (!observedAt) return 0;
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return 0;
  const ageDays = Math.max(0, (Date.now() - observed) / (1000 * 60 * 60 * 24));
  if (ageDays <= 14) return 3;
  if (ageDays <= 45) return 2;
  if (ageDays <= 120) return 1;
  return 0;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSystemAdmin(request);
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: group, error: groupError } = await supabase
      .from("product_groups")
      .select(`
        id,
        name,
        comparison_unit,
        product_group_members (
          product_id,
          products (
            id,
            ean,
            name,
            brand,
            category,
            package_size
          )
        )
      `)
      .eq("id", id)
      .single();

    if (groupError) throw groupError;

    const members = (group.product_group_members ?? []) as unknown as MemberRow[];
    const productMap = new Map<string, ProductRow>();
    const productIds = members
      .map((member) => {
        const productId = String(member.product_id);
        const product = firstProduct(member.products);
        if (product) productMap.set(productId, product);
        return productId;
      })
      .filter(Boolean);

    if (!productIds.length) {
      return NextResponse.json({
        group: {
          id: group.id,
          name: group.name,
          comparison_unit: group.comparison_unit
        },
        prices: [],
        cheapest: null
      });
    }

    const { data: observations, error: observationsError } = await supabase
      .from("price_observations")
      .select(`
        id,
        product_id,
        store_code,
        store_name,
        price,
        unit_price,
        comparison_unit,
        package_quantity,
        package_unit,
        unit_price_source,
        observed_at,
        source
      `)
      .in("product_id", productIds)
      .not("price", "is", null)
      .order("observed_at", { ascending: false })
      .limit(500);

    if (observationsError) throw observationsError;

    const byProductAndStore = new Map<string, PriceObservationRow>();

    for (const observation of (observations ?? []) as unknown as PriceObservationRow[]) {
      const productId = String(observation.product_id);
      const storeKey = `${productId}:${String(observation.store_code ?? observation.store_name ?? "")}`;
      if (!byProductAndStore.has(storeKey)) {
        byProductAndStore.set(storeKey, observation);
      }
    }

    const prices = [...byProductAndStore.values()]
      .map((observation) => {
        const productId = String(observation.product_id);
        const product = productMap.get(productId) ?? null;
        const price = numberOrNull(observation.price);
        const storedUnitPrice = numberOrNull(observation.unit_price);
        const comparisonUnit = observation.comparison_unit ?? group.comparison_unit ?? null;
        const recomputed = recomputeUnitPrice(price, product, comparisonUnit);
        const chosen = chooseUnitPrice({
          storedUnitPrice,
          recomputedUnitPrice: recomputed
        });

        return {
          id: observation.id,
          product_id: productId,
          product,
          store_code: observation.store_code,
          store_name: observation.store_name,
          price,
          unit_price: chosen.unitPrice,
          stored_unit_price: storedUnitPrice,
          recomputed_unit_price: recomputed,
          unit_price_quality: chosen.quality,
          unit_price_was_corrected: chosen.wasCorrected,
          comparison_unit: comparisonUnit,
          package_quantity: inferPackageQuantity(product, comparisonUnit) ?? numberOrNull(observation.package_quantity),
          package_unit: observation.package_unit,
          unit_price_source: observation.unit_price_source,
          observed_at: observation.observed_at,
          source: observation.source,
          freshness_score: ageWeight(observation.observed_at)
        };
      })
      .sort((a, b) => {
        const aUnit = a.unit_price ?? Number.POSITIVE_INFINITY;
        const bUnit = b.unit_price ?? Number.POSITIVE_INFINITY;
        if (aUnit !== bUnit) return aUnit - bUnit;

        const aObserved = a.observed_at ? Date.parse(a.observed_at) : 0;
        const bObserved = b.observed_at ? Date.parse(b.observed_at) : 0;
        return bObserved - aObserved;
      })
      .slice(0, 100);

    const cheapest = prices.find((price) => price.unit_price !== null) ?? prices[0] ?? null;

    return NextResponse.json({
      group: {
        id: group.id,
        name: group.name,
        comparison_unit: group.comparison_unit
      },
      cheapest,
      prices
    });
  } catch (error) {
    console.error("[api/admin/product-groups/prices] failed", error);
    return systemAdminErrorResponse(error);
  }
}
