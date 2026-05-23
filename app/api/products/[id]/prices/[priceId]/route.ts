import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { canonicalStoreName, normalizeStoreCode } from "@/lib/price-observations";
import { getSupabaseAdmin } from "@/lib/supabase-server";

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
    const unitPrice = toNullableNumber(body.unit_price);
    const storeName = String(body.store_name ?? "").trim();

    if (!price || price <= 0) {
      return NextResponse.json({ error: "Pris må være større enn 0" }, { status: 400 });
    }

    if (!storeName) {
      return NextResponse.json({ error: "Butikk mangler" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const existing = await supabase
      .from("price_observations")
      .select("id, product_id")
      .eq("id", priceId)
      .eq("product_id", id)
      .limit(1);

    if (existing.error) throw existing.error;
    if (!existing.data?.[0]) {
      return NextResponse.json({ error: "Fant ikke prisobservasjon" }, { status: 404 });
    }

    const storeCode = normalizeStoreCode(storeName);
    const payload = {
      price,
      unit_price: unitPrice,
      store_name: canonicalStoreName(storeCode, storeName),
      store_code: storeCode,
      source: "manual-price-edit"
    };

    const updated = await supabase
      .from("price_observations")
      .update(payload)
      .eq("id", priceId)
      .eq("product_id", id)
      .select("id, store_code, store_name, price, unit_price, observed_at, source, source_url")
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
