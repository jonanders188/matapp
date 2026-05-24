import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const relationshipTypes = new Set([
  "same_product_different_package",
  "same_product_variant",
  "same_category_alternative",
  "not_comparable"
]);

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nullableText(value: unknown) {
  const text = cleanText(value);
  return text ? text : null;
}

function toConfidence(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSystemAdmin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const productId = cleanText(body?.product_id);
    if (!productId) {
      return NextResponse.json({ error: "product_id for EAN-vare mangler" }, { status: 400 });
    }

    const relationshipType = cleanText(body?.relationship_type) || "same_product_different_package";
    if (!relationshipTypes.has(relationshipType)) {
      return NextResponse.json({ error: "Ugyldig relationship_type" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("product_group_members")
      .upsert(
        {
          group_id: id,
          product_id: productId,
          relationship_type: relationshipType,
          confidence: toConfidence(body?.confidence),
          reason: nullableText(body?.reason),
          source: "manual",
          manually_confirmed: true
        },
        { onConflict: "group_id,product_id" }
      )
      .select(`
        id,
        product_id,
        relationship_type,
        confidence,
        reason,
        source,
        manually_confirmed,
        products (
          id,
          ean,
          name,
          brand,
          category,
          package_size,
          image_url
        )
      `)
      .single();

    if (error) throw error;

    return NextResponse.json({ member: data }, { status: 201 });
  } catch (error) {
    return systemAdminErrorResponse(error);
  }
}
