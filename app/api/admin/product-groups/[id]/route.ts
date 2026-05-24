import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nullableText(value: unknown) {
  const text = cleanText(value);
  return text ? text : null;
}

function normalizeComparisonUnit(value: unknown) {
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (["kg", "l", "stk"].includes(text)) return text;
  return text;
}

async function loadGroup(id: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("product_groups")
    .select(`
      id,
      name,
      brand,
      category,
      comparison_unit,
      description,
      status,
      created_at,
      updated_at,
      product_group_members (
        id,
        product_id,
        relationship_type,
        confidence,
        manually_confirmed,
        reason,
        products (
          id,
          ean,
          name,
          brand,
          category,
          package_size,
          image_url
        )
      )
    `)
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSystemAdmin(request);
    const { id } = await context.params;
    const group = await loadGroup(id);
    return NextResponse.json({ group });
  } catch (error) {
    return systemAdminErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSystemAdmin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const name = cleanText(body?.name);
    if (!name) {
      return NextResponse.json({ error: "Navn på overordnet vare mangler" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("product_groups")
      .update({
        name,
        brand: nullableText(body?.brand),
        category: nullableText(body?.category),
        comparison_unit: normalizeComparisonUnit(body?.comparison_unit),
        description: nullableText(body?.description),
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) throw error;

    const group = await loadGroup(id);
    return NextResponse.json({ group });
  } catch (error) {
    return systemAdminErrorResponse(error);
  }
}
