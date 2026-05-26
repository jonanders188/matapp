import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const admin = await requireSystemAdmin(request);
    const { id } = await context.params;
    if (!id) return jsonError("Bruker-ID mangler", 400);

    if (id === admin.userId) {
      return jsonError("Du kan ikke slette din egen bruker", 400);
    }

    const supabase = getSupabaseAdmin();

    const { data: memberships, error: membershipError } = await supabase
      .from("household_members")
      .select("id")
      .eq("user_id", id)
      .limit(1);

    if (membershipError) throw membershipError;

    if ((memberships ?? []).length > 0) {
      return jsonError("Brukeren kan ikke slettes fordi den er koblet til en husholdning", 409);
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
    if (deleteError) throw deleteError;

    return NextResponse.json({ data: { id }, message: "Brukeren er slettet." });
  } catch (error) {
    console.error("[api/admin/users/[id]] DELETE", error);
    return systemAdminErrorResponse(error);
  }
}
