import { NextResponse } from "next/server";
import { findKassalappProductsByEan } from "@/lib/kassalapp";

export async function GET(req: Request) {
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
