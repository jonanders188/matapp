import { NextResponse } from "next/server";
import { suggestMeals } from "@/lib/meal-suggestion-engine";

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

export async function GET() {
  try {
    const result = await suggestMeals();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/meals/suggest] GET", errorPayload(error, "Ukjent feil"));
    return NextResponse.json(errorPayload(error, "Kunne ikke foreslå middager"), { status: 500 });
  }
}

export async function POST() {
  return GET();
}
