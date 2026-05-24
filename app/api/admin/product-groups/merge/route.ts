import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function POST(request: Request) {
  try {
    await requireSystemAdmin(request);
    const body = await request.json().catch(() => ({}));
    const targetGroupId = cleanText(body?.targetGroupId);
    const sourceGroupId = cleanText(body?.sourceGroupId);

    if (!targetGroupId || !sourceGroupId) {
      return NextResponse.json({ error: "targetGroupId og sourceGroupId må fylles ut" }, { status: 400 });
    }

    if (targetGroupId === sourceGroupId) {
      return NextResponse.json({ error: "Kan ikke slå sammen en overordnet vare med seg selv" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: sourceGroup, error: sourceGroupError } = await supabase
      .from("product_groups")
      .select("id, name")
      .eq("id", sourceGroupId)
      .single();

    if (sourceGroupError) throw sourceGroupError;

    const { data: targetGroup, error: targetGroupError } = await supabase
      .from("product_groups")
      .select("id, name")
      .eq("id", targetGroupId)
      .single();

    if (targetGroupError) throw targetGroupError;

    const { data: sourceMembers, error: sourceMembersError } = await supabase
      .from("product_group_members")
      .select("product_id, relationship_type, confidence, reason, source, manually_confirmed")
      .eq("group_id", sourceGroupId);

    if (sourceMembersError) throw sourceMembersError;

    const { data: targetMembers, error: targetMembersError } = await supabase
      .from("product_group_members")
      .select("product_id")
      .eq("group_id", targetGroupId);

    if (targetMembersError) throw targetMembersError;

    const existingProductIds = new Set((targetMembers ?? []).map((member) => String(member.product_id)));

    const rowsToMove = (sourceMembers ?? [])
      .filter((member) => !existingProductIds.has(String(member.product_id)))
      .map((member) => ({
        group_id: targetGroupId,
        product_id: member.product_id,
        relationship_type: member.relationship_type,
        confidence: member.confidence,
        reason: member.reason ?? `Flyttet fra sammenslått produktgruppe "${sourceGroup.name}".`,
        source: member.source ?? "manual",
        manually_confirmed: member.manually_confirmed ?? true
      }));

    if (rowsToMove.length) {
      const { error: upsertError } = await supabase
        .from("product_group_members")
        .upsert(rowsToMove, { onConflict: "group_id,product_id" });

      if (upsertError) throw upsertError;
    }

    // Delete the source group after moving unique members.
    // product_group_members has ON DELETE CASCADE, so duplicate/remaining source members are removed automatically.
    // This prevents the old group from still showing up after merge.
    const { error: deleteSourceError } = await supabase
      .from("product_groups")
      .delete()
      .eq("id", sourceGroupId);

    if (deleteSourceError) throw deleteSourceError;

    const { error: targetUpdateError } = await supabase
      .from("product_groups")
      .update({
        updated_at: new Date().toISOString(),
        description: targetGroup.name === sourceGroup.name
          ? undefined
          : `Sammenslått med "${sourceGroup.name}".`
      })
      .eq("id", targetGroupId);

    if (targetUpdateError) throw targetUpdateError;

    return NextResponse.json({
      ok: true,
      movedMemberCount: rowsToMove.length,
      deletedSourceGroupId: sourceGroupId,
      deletedSourceGroupName: sourceGroup.name
    });
  } catch (error) {
    console.error("[api/admin/product-groups/merge] failed", error);
    return systemAdminErrorResponse(error);
  }
}
