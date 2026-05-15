import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const apiKey = process.env.KASSALAPP_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "KASSALAPP_API_KEY mangler" }, { status: 500 });
  const url = new URL(req.url);
  const ean = url.searchParams.get("ean");
  if (!ean) return NextResponse.json({ error: "Mangler ean" }, { status: 400 });
  const res = await fetch(`https://kassal.app/api/v1/products?search=${encodeURIComponent(ean)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 60 * 60 }
  });
  const data = await res.json();
  return NextResponse.json(data);
}
