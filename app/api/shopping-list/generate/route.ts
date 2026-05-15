import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { generateShoppingList } from "@/lib/shopping-list-engine";

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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const maxStores = typeof body?.maxStores === "number" ? body.maxStores : 2;
    const { householdId } = await requireCurrentHousehold(request);
    const result = await generateShoppingList({ maxStores, householdId });
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("[api/shopping-list/generate]", errorPayload(error, "Ukjent feil"));
    return apiErrorResponse(error);
  }
}
