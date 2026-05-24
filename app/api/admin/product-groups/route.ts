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

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const supabase = getSupabaseAdmin();

    const { data: groups, error } = await supabase
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
      .order("updated_at", { ascending: false })
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ groups: groups ?? [] });
  } catch (error) {
    return systemAdminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireSystemAdmin(request);
    const body = await request.json().catch(() => ({}));

    const name = cleanText(body?.name);
    if (!name) {
      return NextResponse.json({ error: "Navn på overordnet vare mangler" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("product_groups")
      .insert({
        name,
        brand: nullableText(body?.brand),
        category: nullableText(body?.category),
        comparison_unit: normalizeComparisonUnit(body?.comparison_unit),
        description: nullableText(body?.description),
        status: "active",
        created_by: admin.userId === "00000000-0000-0000-0000-000000000000" ? null : admin.userId
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ group: data }, { status: 201 });
  } catch (error) {
    return systemAdminErrorResponse(error);
  }
}
