import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const allowedStatuses = new Set(["candidate", "testing", "accepted", "rejected"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = String(body?.status ?? "");

    if (!allowedStatuses.has(status)) {
      return NextResponse.json({ error: "Ugyldig status" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("product_alternatives")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, status")
      .limit(1);

    if (error) throw error;
    return NextResponse.json({ data: data?.[0] ?? null });
  } catch (error) {
    console.error("[api/alternatives/[id]] PATCH feilet", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunne ikke oppdatere alternativ" }, { status: 500 });
  }
}
