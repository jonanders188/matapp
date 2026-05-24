import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const supabase = getSupabaseAdmin();

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "pending";

    let query = supabase
      .from("product_group_suggestions")
      .select(`
        id,
        status,
        suggested_group_name,
        brand,
        category,
        comparison_unit,
        confidence,
        reason,
        raw,
        created_at,
        reviewed_at,
        product_group_suggestion_members (
          id,
          product_id,
          relationship_type,
          confidence,
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
      .order("created_at", { ascending: false })
      .limit(100);

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ suggestions: data ?? [] });
  } catch (error) {
    return systemAdminErrorResponse(error);
  }
}
