import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";

type ApiErrorLike = { message?: string; code?: string; details?: string; hint?: string };

type PurchaseItemInput = {
  product_id?: string | null;
  raw_name?: string;
  quantity?: number | string | null;
  unit?: string | null;
  paid_price?: number | string | null;
  discount?: number | string | null;
  trumf_percent?: number | string | null;
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

function toNumber(value: unknown, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);

    const purchases = await supabase
      .from("purchases")
      .select("id, store_name, receipt_no, purchased_at, total_amount, trumf_bonus, source, created_at")
      .eq("household_id", householdId)
      .order("purchased_at", { ascending: false })
      .limit(30);

    if (purchases.error) throw purchases.error;

    const purchaseIds = (purchases.data ?? []).map((purchase) => purchase.id);
    let items: Array<Record<string, unknown>> = [];

    if (purchaseIds.length) {
      const itemResult = await supabase
        .from("purchase_items")
        .select("id, purchase_id, product_id, raw_name, quantity, unit, paid_price, discount, trumf_percent")
        .in("purchase_id", purchaseIds)
        .order("created_at", { ascending: true });

      if (itemResult.error) throw itemResult.error;
      items = itemResult.data ?? [];
    }

    const itemsByPurchase = new Map<string, Array<Record<string, unknown>>>();
    for (const item of items) {
      const purchaseId = String(item.purchase_id);
      const existing = itemsByPurchase.get(purchaseId) ?? [];
      existing.push(item);
      itemsByPurchase.set(purchaseId, existing);
    }

    return NextResponse.json({
      data: (purchases.data ?? []).map((purchase) => ({
        ...purchase,
        items: itemsByPurchase.get(purchase.id) ?? []
      }))
    });
  } catch (error) {
    console.error("[api/purchases] GET feilet", errorPayload(error, "Kunne ikke hente kjøp"));
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const { householdId } = await requireCurrentHousehold(request);
    const items = Array.isArray(body.items) ? (body.items as PurchaseItemInput[]) : [];

    if (!String(body.store_name ?? "").trim()) {
      return NextResponse.json({ error: "Butikk mangler" }, { status: 400 });
    }

    if (!items.length) {
      return NextResponse.json({ error: "Legg inn minst én varelinje" }, { status: 400 });
    }

    const totalFromItems = items.reduce((sum, item) => sum + toNumber(item.paid_price), 0);

    const purchaseResult = await supabase
      .from("purchases")
      .insert({
        household_id: householdId,
        store_name: String(body.store_name).trim(),
        receipt_no: body.receipt_no ? String(body.receipt_no).trim() : null,
        purchased_at: body.purchased_at ? new Date(body.purchased_at).toISOString() : new Date().toISOString(),
        total_amount: toNumber(body.total_amount, totalFromItems),
        trumf_bonus: toNumber(body.trumf_bonus, 0),
        source: "manual"
      })
      .select("id")
      .limit(1);

    if (purchaseResult.error) throw purchaseResult.error;
    const purchaseId = purchaseResult.data?.[0]?.id;
    if (!purchaseId) throw new Error("Kunne ikke opprette kjøp");

    const itemPayloads = items.map((item) => ({
      purchase_id: purchaseId,
      product_id: item.product_id || null,
      raw_name: String(item.raw_name ?? "Ukjent vare").trim(),
      quantity: toNumber(item.quantity, 1),
      unit: item.unit ? String(item.unit).trim() : "stk",
      paid_price: toNumber(item.paid_price, 0),
      discount: toNumber(item.discount, 0),
      trumf_percent: item.trumf_percent === "" || item.trumf_percent === null || item.trumf_percent === undefined ? null : toNumber(item.trumf_percent, 0)
    }));

    const itemInsert = await supabase.from("purchase_items").insert(itemPayloads);
    if (itemInsert.error) throw itemInsert.error;

    const warnings: string[] = [];
    for (const item of itemPayloads) {
      if (!item.product_id) continue;
      const inventory = await supabase
        .from("inventory_items")
        .select("id, quantity")
        .eq("household_id", householdId)
        .eq("product_id", item.product_id)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (inventory.error) {
        warnings.push(`Kunne ikke lese lager for ${item.raw_name}`);
        continue;
      }

      if (inventory.data?.[0]) {
        const currentQuantity = toNumber(inventory.data[0].quantity, 0);
        const update = await supabase
          .from("inventory_items")
          .update({ quantity: currentQuantity + item.quantity, updated_at: new Date().toISOString() })
          .eq("id", inventory.data[0].id);
        if (update.error) warnings.push(`Kunne ikke oppdatere lager for ${item.raw_name}`);
      }
    }

    return NextResponse.json({ data: { id: purchaseId }, warnings });
  } catch (error) {
    console.error("[api/purchases] POST feilet", errorPayload(error, "Kunne ikke lagre kjøp"));
    return apiErrorResponse(error);
  }
}
