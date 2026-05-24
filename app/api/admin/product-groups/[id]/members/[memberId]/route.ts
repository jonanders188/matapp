import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { createNegativeMatches } from "@/lib/product-group-negative-matches";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const admin = await requireSystemAdmin(request);
    const { id, memberId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const rememberAsNegative = body?.rememberAsNegative !== false;

    const supabase = getSupabaseAdmin();

    const { data: member, error: memberError } = await supabase
      .from("product_group_members")
      .select("id, group_id, product_id, products(name)")
      .eq("id", memberId)
      .eq("group_id", id)
      .single();

    if (memberError) throw memberError;

    const { data: otherMembers, error: otherError } = await supabase
      .from("product_group_members")
      .select("product_id")
      .eq("group_id", id)
      .neq("id", memberId);

    if (otherError) throw otherError;

    const { error: deleteError } = await supabase
      .from("product_group_members")
      .delete()
      .eq("id", memberId)
      .eq("group_id", id);

    if (deleteError) throw deleteError;

    let negativeMatchCount = 0;
    if (rememberAsNegative && otherMembers?.length) {
      const result = await createNegativeMatches(
        otherMembers.map((other) => ({
          productIdA: String(member.product_id),
          productIdB: String(other.product_id),
          reason: "System Admin tok produktet ut av en godkjent produktgruppe.",
          source: "system_admin_removed_member" as const,
          createdBy: admin.userId === "00000000-0000-0000-0000-000000000000" ? null : admin.userId
        }))
      );
      negativeMatchCount = result.count;
    }

    return NextResponse.json({ ok: true, negativeMatchCount });
  } catch (error) {
    console.error("[api/admin/product-groups/members/delete] failed", error);
    return systemAdminErrorResponse(error);
  }
}
