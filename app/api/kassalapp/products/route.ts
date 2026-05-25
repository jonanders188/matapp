import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/current-household";
import { findKassalappProductsByEan } from "@/lib/kassalapp";

export async function GET(req: Request) {
  try {
    await requireAuthenticatedUser(req);
  } catch (error) {
    return apiErrorResponse(error);
  }
  const url = new URL(req.url);
  const ean = url.searchParams.get("ean");

  if (!ean) {
    return NextResponse.json({ error: "Mangler ean" }, { status: 400 });
  }

  try {
    const products = await findKassalappProductsByEan(ean);
    return NextResponse.json({ data: products });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ukjent feil fra Kassalapp" },
      { status: 500 }
    );
  }
}
