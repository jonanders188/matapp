import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductRow = {
  id: string;
  ean: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  package_size: string | null;
  image_url?: string | null;
};

type GroupMemberRow = {
  product_id: string;
  products: ProductRow | ProductRow[] | null;
};

function firstProduct(value: ProductRow | ProductRow[] | null | undefined): ProductRow | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: unknown) {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length >= 2));
}

function overlapScore(a: unknown, b: unknown) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;

  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }

  return common / Math.max(left.size, right.size);
}

function expandSearchTerms(value: unknown) {
  const terms = new Set(normalizeText(value).split(/\s+/).filter(Boolean));

  if (terms.has("coca") || terms.has("cola")) {
    terms.add("coca");
    terms.add("cola");
    terms.add("coke");
  }

  if (terms.has("zero")) {
    terms.add("sukker");
    terms.add("sukkerfri");
    terms.add("uten");
  }

  if (terms.has("melkesjokolade") || terms.has("sjokolade") || terms.has("freia")) {
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
    terms.add("sukker");
  }

  return [...terms].filter((term) => term.length >= 2).slice(0, 10);
}

function productText(product: ProductRow) {
  return [product.name, product.brand, product.category, product.package_size, product.ean].filter(Boolean).join(" ");
}

function groupText(group: {
  name: string | null;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
}, members: GroupMemberRow[]) {
  const memberText = members.map((member) => {
    const product = firstProduct(member.products);
    return product ? productText(product) : "";
  }).join(" ");
  return [group.name, group.brand, group.category, group.comparison_unit, memberText].filter(Boolean).join(" ");
}

function scoreCandidate(product: ProductRow, group: {
  name: string | null;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
}, members: GroupMemberRow[]) {
  const reasons: string[] = [];
  let score = 0;

  const brandA = normalizeText(product.brand);
  const brandB = normalizeText(group.brand);
  if (brandA && brandB && (brandA === brandB || brandA.includes(brandB) || brandB.includes(brandA))) {
    score += 25;
    reasons.push("likt merke");
  }

  const categoryA = normalizeText(product.category);
  const categoryB = normalizeText(group.category);
  if (categoryA && categoryB && (categoryA === categoryB || categoryA.includes(categoryB) || categoryB.includes(categoryA))) {
    score += 25;
    reasons.push("lik kategori");
  }

  const groupNameScore = overlapScore(product.name, group.name);
  if (groupNameScore >= 0.2) {
    score += Math.round(groupNameScore * 35);
    reasons.push("lignende navn");
  }

  const fullScore = overlapScore(productText(product), groupText(group, members));
  if (fullScore >= 0.12) {
    score += Math.round(fullScore * 35);
    reasons.push("ligner eksisterende EAN-varer");
  }

  for (const member of members) {
    const memberProduct = firstProduct(member.products);
    if (!memberProduct) continue;
    const memberScore = overlapScore(productText(product), productText(memberProduct));
    if (memberScore >= 0.25) {
      score += Math.round(memberScore * 35);
      reasons.push("ligner eksisterende EAN-vare");
      break;
    }
  }

  return { score, reasons: [...new Set(reasons)] };
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
        brand,
        category,
        comparison_unit,
        product_group_members (
          product_id,
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

    if (groupError) throw groupError;

    const members = (group.product_group_members ?? []) as unknown as GroupMemberRow[];
    const existingProductIds = new Set(members.map((member) => String(member.product_id)));
    const terms = expandSearchTerms(groupText(group, members));

    let productsQuery = supabase
      .from("products")
      .select("id, ean, name, brand, category, package_size, image_url")
      .order("name", { ascending: true })
      .limit(300);

    const filters = terms.flatMap((term) => {
      const pattern = `%${term.replace(/[%_]/g, "")}%`;
      return [
        `name.ilike.${pattern}`,
        `brand.ilike.${pattern}`,
        `category.ilike.${pattern}`,
        `ean.ilike.${pattern}`
      ];
    });

    if (filters.length) productsQuery = productsQuery.or(filters.join(","));

    const { data: products, error: productsError } = await productsQuery;
    if (productsError) throw productsError;

    const candidates = ((products ?? []) as ProductRow[])
      .filter((product) => !existingProductIds.has(String(product.id)))
      .map((product) => {
        const scored = scoreCandidate(product, group, members);
        return {
          ...product,
          ai_score: scored.score,
          ai_reason: scored.reasons.join(" · ") || "Mulig kandidat basert på navn, merke eller kategori."
        };
      })
      .filter((product) => product.ai_score >= 20)
      .sort((a, b) => b.ai_score - a.ai_score)
      .slice(0, 40);

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error("[api/admin/product-groups/ai-candidates] failed", error);
    return systemAdminErrorResponse(error);
  }
}
