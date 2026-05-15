import { NextResponse } from "next/server";
import { ensureDefaultHousehold } from "@/lib/db";
import { calculateRecommendations, saveRecommendations } from "@/lib/recommendation-engine";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function errorPayload(error: unknown, fallback: string) {
  const err = error as ApiErrorLike | null;
  return {
    error: error instanceof Error ? error.message : err?.message ?? fallback,
    code: err?.code ?? null,
    details: err?.details ?? null,
    hint: err?.hint ?? null
  };
}

function actionLabel(action: string) {
  switch (action) {
    case "buy":
      return "Kjøp nå";
    case "stock_up":
      return "Hamstre";
    case "wait":
      return "Vent";
    case "use_up":
      return "Bruk opp";
    case "switch_brand":
      return "Bytt alternativ";
    default:
      return action;
  }
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const household = await ensureDefaultHousehold();

    const recs = await supabase
      .from("recommendations")
      .select("id, product_id, action, store_name, price, estimated_saving, reason, valid_until, created_at")
      .eq("household_id", household.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (recs.error) throw recs.error;

    const productIds = [...new Set((recs.data ?? []).map((rec) => rec.product_id).filter(Boolean))];
    const products = productIds.length
      ? await supabase.from("products").select("id, name, brand, category, image_url, target_price, desired_stock").in("id", productIds)
      : { data: [], error: null };

    if (products.error) throw products.error;

    const productById = new Map((products.data ?? []).map((product) => [product.id, product]));

    const data = (recs.data ?? []).map((rec) => {
      const product = productById.get(rec.product_id);
      return {
        ...rec,
        product_name: product?.name ?? "Ukjent produkt",
        brand: product?.brand ?? null,
        category: product?.category ?? null,
        image_url: product?.image_url ?? null,
        target_price: product?.target_price ?? null,
        desired_stock: product?.desired_stock ?? null,
        action_label: actionLabel(rec.action)
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(errorPayload(error, "Kunne ikke hente anbefalinger"), { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await saveRecommendations();
    return NextResponse.json({
      data: result.recommendations,
      count: result.recommendations.length
    });
  } catch (error) {
    return NextResponse.json(errorPayload(error, "Kunne ikke generere anbefalinger"), { status: 500 });
  }
}

export async function PUT() {
  try {
    const result = await calculateRecommendations();
    return NextResponse.json({ data: result.recommendations, count: result.recommendations.length, dryRun: true });
  } catch (error) {
    return NextResponse.json(errorPayload(error, "Kunne ikke beregne anbefalinger"), { status: 500 });
  }
}
