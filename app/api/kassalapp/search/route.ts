import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/current-household";
import { latestPriceDate, searchKassalappProducts } from "@/lib/kassalapp";

export async function GET(request: Request) {
  try {
    await requireAuthenticatedUser(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ error: "Mangler q" }, { status: 400 });
  }

  try {
    const products = await searchKassalappProducts(query, 20);
    return NextResponse.json({
      data: products.map((product) => ({
        ...product,
        latest_price_date: latestPriceDate(product)
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ukjent feil fra Kassalapp" },
      { status: 500 }
    );
  }
}
