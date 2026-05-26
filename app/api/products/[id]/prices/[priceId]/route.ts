import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { canonicalStoreName, normalizeStoreCode } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { unitPricingColumnsForProduct } from "@/lib/unit-pricing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function requireAdmin(role: string | null | undefined) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Bare admin kan endre prisobservasjoner" }, { status: 403 });
  }

  return null;
}

function toNullableNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; priceId: string }> }) {
  try {
    const { id, priceId } = await context.params;
    const current = await requireCurrentHousehold(request);
    const adminError = requireAdmin(current.role);
    if (adminError) return adminError;

    const body = await request.json().catch(() => ({}));
    const price = toNullableNumber(body.price);
    const storeName = String(body.store_name ?? "").trim();
    const excludeFromAnalysis = body.exclude_from_analysis === true;

    if (!excludeFromAnalysis && (!price || price <= 0)) {
      return NextResponse.json({ error: "Pris må være større enn 0" }, { status: 400 });
    }

    if (!excludeFromAnalysis && !storeName) {
      return NextResponse.json({ error: "Butikk mangler" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const existing = await supabase
      .from("price_observations")
      .select("id, product_id, comparison_unit")
      .eq("id", priceId)
      .eq("product_id", id)
      .limit(1);

    if (existing.error) throw existing.error;
    if (!existing.data?.[0]) {
      return NextResponse.json({ error: "Fant ikke prisobservasjon" }, { status: 404 });
    }

    if (excludeFromAnalysis) {
      const updated = await supabase
        .from("price_observations")
        .update({
          exclude_from_analysis: true,
          confidence: "low",
          source: "manual-excluded-from-analysis",
          raw: {
            excluded_from_analysis: true,
            excluded_reason: String(body.reason ?? "Marked as wrong price in product maintenance"),
            excluded_at: new Date().toISOString()
          }
        })
        .eq("id", priceId)
        .eq("product_id", id)
        .select("id, store_code, store_name, price, unit_price, comparison_unit, package_quantity, package_unit, observed_at, source, source_url, price_type, confidence, exclude_from_analysis, valid_from, valid_until")
        .single();

      if (updated.error) throw updated.error;
      return NextResponse.json({ data: updated.data });
    }

    const productResult = await supabase
      .from("products")
      .select("id, name, brand, category, package_size, net_content_value, net_content_unit, comparison_unit")
      .eq("id", id)
      .limit(1);

    if (productResult.error) throw productResult.error;
    const product = productResult.data?.[0];
    if (!product) {
      return NextResponse.json({ error: "Fant ikke produkt" }, { status: 404 });
    }

    const unitPricing = unitPricingColumnsForProduct(
      {
        name: product.name,
        brand: product.brand ?? null,
        category: product.category ?? null,
        package_size: product.package_size ?? null,
        net_content_value: product.net_content_value ?? null,
        net_content_unit: product.net_content_unit ?? null,
        comparison_unit: existing.data[0].comparison_unit ?? product.comparison_unit ?? null
      },
      price
    );

    const storeCode = normalizeStoreCode(storeName);
    const payload = {
      price,
      unit_price: unitPricing.unit_price,
      comparison_unit: unitPricing.comparison_unit,
      package_quantity: unitPricing.package_quantity,
      package_unit: unitPricing.package_unit,
      unit_price_source: unitPricing.unit_price_source,
      store_name: canonicalStoreName(storeCode, storeName),
      store_code: storeCode,
      source: "manual-price-edit",
      raw: {
        manual_price_edit: true,
        unit_pricing: unitPricing.raw_unit_pricing
      }
    };

    const updated = await supabase
      .from("price_observations")
      .update(payload)
      .eq("id", priceId)
      .eq("product_id", id)
      .select("id, store_code, store_name, price, unit_price, comparison_unit, package_quantity, package_unit, observed_at, source, source_url, price_type, confidence, exclude_from_analysis, valid_from, valid_until")
      .single();

    if (updated.error) throw updated.error;

    return NextResponse.json({ data: updated.data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; priceId: string }> }) {
  try {
    const { id, priceId } = await context.params;
    const current = await requireCurrentHousehold(request);
    const adminError = requireAdmin(current.role);
    if (adminError) return adminError;

    const supabase = getSupabaseAdmin();

    const deleted = await supabase
      .from("price_observations")
      .delete()
      .eq("id", priceId)
      .eq("product_id", id)
      .select("id")
      .single();

    if (deleted.error) throw deleted.error;

    return NextResponse.json({ data: deleted.data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
