import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function termsForQuery(query: string) {
  const terms = new Set(
    query
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/æ/g, "ae")
      .replace(/ø/g, "o")
      .replace(/å/g, "a")
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
  );

  if (terms.has("cola") || terms.has("coca") || terms.has("zero")) {
    terms.add("coca");
    terms.add("cola");
    terms.add("zero");
    terms.add("sukker");
    terms.add("sukkerfri");
    terms.add("uten");
  }

  if (terms.has("melkesjokolade") || terms.has("melkesjoko") || terms.has("sjokolade") || terms.has("freia")) {
    terms.add("melkesjokolade");
    terms.add("melkesjoko");
    terms.add("sjokolade");
    terms.add("freia");
  }

  if (terms.has("ketchup") || terms.has("tomatketchup")) {
    terms.add("ketchup");
    terms.add("tomatketchup");
    terms.add("uts");
    terms.add("usotet");
  }

  return [...terms].slice(0, 10);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSystemAdmin(request);
    const { id } = await context.params;
    const url = new URL(request.url);
    const q = cleanText(url.searchParams.get("q"));
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30), 1), 80);

    const supabase = getSupabaseAdmin();

    const { data: existingMembers, error: membersError } = await supabase
      .from("product_group_members")
      .select("product_id")
      .eq("group_id", id);

    if (membersError) throw membersError;
    const existingProductIds = new Set((existingMembers ?? []).map((member) => String(member.product_id)));

    let query = supabase
      .from("products")
      .select("id, ean, name, brand, category, package_size, image_url")
      .order("name", { ascending: true })
      .limit(limit);

    if (q) {
      const filters = termsForQuery(q).flatMap((term) => {
        const pattern = `%${term.replace(/[%_]/g, "")}%`;
        return [
          `name.ilike.${pattern}`,
          `brand.ilike.${pattern}`,
          `category.ilike.${pattern}`,
          `ean.ilike.${pattern}`
        ];
      });

      if (filters.length) {
        query = query.or(filters.join(","));
      }
    }

    const { data: products, error } = await query;
    if (error) throw error;

    const candidates = (products ?? []).filter((product) => !existingProductIds.has(String(product.id)));
    return NextResponse.json({ candidates });
  } catch (error) {
    return systemAdminErrorResponse(error);
  }
}
