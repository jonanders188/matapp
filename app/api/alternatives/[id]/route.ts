import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const allowedStatuses = new Set(["candidate", "testing", "accepted", "rejected"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const current = await requireCurrentHousehold(request);
    if (current.role !== "admin") {
      return NextResponse.json({ error: "Kun admin kan gjøre dette" }, { status: 403 });
    }
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
      .eq("household_id", current.householdId)
      .select("id, status")
      .limit(1);

    if (error) throw error;
    return NextResponse.json({ data: data?.[0] ?? null });
  } catch (error) {
    console.error("[api/alternatives/[id]] PATCH feilet", error);
    return apiErrorResponse(error);
  }
}
