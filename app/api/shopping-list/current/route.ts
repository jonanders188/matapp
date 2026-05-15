import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getCurrentShoppingList } from "@/lib/shopping-list-engine";

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

export async function GET(request: Request) {
  try {
    const { householdId } = await requireCurrentHousehold(request);
    const result = await getCurrentShoppingList(householdId);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("[api/shopping-list/current]", errorPayload(error, "Ukjent feil"));
    return apiErrorResponse(error);
  }
}
