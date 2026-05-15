import { NextResponse } from "next/server";
import { ensureDefaultHousehold } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

type Body = {
  action?: "increment" | "decrement" | "mark_empty" | "set_quantity" | "set_desired" | "set_location";
  quantity?: number;
  desiredQuantity?: number;
  location?: string;
  expiresAt?: string | null;
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
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampQuantity(value: number) {
  return Math.max(0, Math.round(value * 100) / 100);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Body;
    const supabase = getSupabaseAdmin();
    const household = await ensureDefaultHousehold();

    const existing = await supabase
      .from("inventory_items")
      .select("id, household_id, quantity, desired_quantity, location, expires_at")
      .eq("id", id)
      .eq("household_id", household.id)
      .limit(1);

    if (existing.error) throw existing.error;
    const item = existing.data?.[0];

    if (!item) {
      return NextResponse.json({ error: "Fant ikke lagerlinje" }, { status: 404 });
    }

    const currentQuantity = toNumber(item.quantity);
    const currentDesired = toNumber(item.desired_quantity);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    switch (body.action) {
      case "increment":
        update.quantity = clampQuantity(currentQuantity + toNumber(body.quantity, 1));
        break;
      case "decrement":
        update.quantity = clampQuantity(currentQuantity - toNumber(body.quantity, 1));
        break;
      case "mark_empty":
        update.quantity = 0;
        break;
      case "set_quantity":
        update.quantity = clampQuantity(toNumber(body.quantity, currentQuantity));
        break;
      case "set_desired":
        update.desired_quantity = clampQuantity(toNumber(body.desiredQuantity, currentDesired));
        break;
      case "set_location":
        if (body.location && body.location.trim()) update.location = body.location.trim();
        break;
      default:
        if (typeof body.quantity === "number") update.quantity = clampQuantity(body.quantity);
        if (typeof body.desiredQuantity === "number") update.desired_quantity = clampQuantity(body.desiredQuantity);
        if (body.location && body.location.trim()) update.location = body.location.trim();
        break;
    }

    if ("expiresAt" in body) {
      update.expires_at = body.expiresAt || null;
    }

    const updated = await supabase
      .from("inventory_items")
      .update(update)
      .eq("id", id)
      .eq("household_id", household.id)
      .select("id, quantity, desired_quantity, location, expires_at, updated_at")
      .limit(1);

    if (updated.error) throw updated.error;

    return NextResponse.json({ data: updated.data?.[0] ?? null });
  } catch (error) {
    console.error("[api/inventory/items/:id] PATCH", errorPayload(error, "Ukjent feil"));
    return NextResponse.json(errorPayload(error, "Kunne ikke oppdatere lager"), { status: 500 });
  }
}
