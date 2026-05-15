import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-guard";
import { generateProductAlternatives } from "@/lib/alternative-engine";

export async function POST(request: Request) {
  const unauthorized = await requireAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const result = await generateProductAlternatives({ limit: Number(body?.limit ?? 50) });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/alternatives/generate] POST feilet", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunne ikke generere alternativer" }, { status: 500 });
  }
}
