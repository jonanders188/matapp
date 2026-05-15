import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-guard";
import { saveRecommendations } from "@/lib/recommendation-engine";

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
  const unauthorized = await requireAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await saveRecommendations();
    return NextResponse.json({ data: result.recommendations, count: result.recommendations.length });
  } catch (error) {
    console.error("[api/recommendations/generate] POST feilet", errorPayload(error, "Kunne ikke generere anbefalinger"));
    return NextResponse.json(errorPayload(error, "Kunne ikke generere anbefalinger"), { status: 500 });
  }
}
