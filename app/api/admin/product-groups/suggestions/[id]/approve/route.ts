import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { createNegativeMatches } from "@/lib/product-group-negative-matches";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireSystemAdmin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const selectedMemberIds = new Set(asStringArray(body?.selectedMemberIds));
    const rememberRemovedMembers = body?.rememberRemovedMembers !== false;

    const supabase = getSupabaseAdmin();

    const { data: suggestion, error: suggestionError } = await supabase
      .from("product_group_suggestions")
      .select(`
        id,
        status,
        suggested_group_name,
        brand,
        category,
        comparison_unit,
        reason,
        product_group_suggestion_members (
          id,
          product_id,
          relationship_type,
          confidence,
          reason
        )
      `)
      .eq("id", id)
      .single();

    if (suggestionError) throw suggestionError;

    if (suggestion.status !== "pending") {
      return NextResponse.json({ error: "Forslaget er allerede behandlet" }, { status: 409 });
    }

    const allMembers = suggestion.product_group_suggestion_members ?? [];
    const comparableMembers = allMembers.filter((member) => member.relationship_type !== "not_comparable");

    const selectedMembers = selectedMemberIds.size
      ? comparableMembers.filter((member) => selectedMemberIds.has(String(member.id)))
      : comparableMembers;

    if (selectedMembers.length < 2) {
      return NextResponse.json({ error: "Velg minst to EAN-varer som skal inn i den overordnede varen." }, { status: 400 });
    }

    const removedMembers = comparableMembers.filter(
      (member) => !selectedMembers.some((selected) => selected.id === member.id)
    );

    const { data: group, error: groupError } = await supabase
      .from("product_groups")
      .insert({
        name: suggestion.suggested_group_name,
        brand: suggestion.brand,
        category: suggestion.category,
        comparison_unit: suggestion.comparison_unit,
        description: suggestion.reason,
        status: "active",
        created_by: admin.userId === "00000000-0000-0000-0000-000000000000" ? null : admin.userId
      })
      .select("id")
      .single();

    if (groupError) throw groupError;

    const members = selectedMembers.map((member) => ({
      group_id: group.id,
      product_id: member.product_id,
      relationship_type: member.relationship_type,
      confidence: member.confidence,
      reason: member.reason,
      source: "ai_suggestion",
      manually_confirmed: true
    }));

    const { error: membersError } = await supabase
      .from("product_group_members")
      .upsert(members, { onConflict: "group_id,product_id" });

    if (membersError) throw membersError;

    let negativeMatchCount = 0;
    if (rememberRemovedMembers && removedMembers.length) {
      const negativeMatches = [];
      for (const removed of removedMembers) {
        for (const selected of selectedMembers) {
          negativeMatches.push({
            productIdA: String(removed.product_id),
            productIdB: String(selected.product_id),
            reason: `System Admin valgte bort produktet fra forslaget "${suggestion.suggested_group_name}".`,
            source: "system_admin_removed_member" as const,
            createdBy: admin.userId === "00000000-0000-0000-0000-000000000000" ? null : admin.userId
          });
        }
      }
      const result = await createNegativeMatches(negativeMatches);
      negativeMatchCount = result.count;
    }

    const { error: updateError } = await supabase
      .from("product_group_suggestions")
      .update({
        status: "approved",
        reviewed_by: admin.userId === "00000000-0000-0000-0000-000000000000" ? null : admin.userId,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({
      groupId: group.id,
      memberCount: members.length,
      removedMemberCount: removedMembers.length,
      negativeMatchCount
    });
  } catch (error) {
    console.error("[api/admin/product-groups/suggestions/approve] failed", error);
    return systemAdminErrorResponse(error);
  }
}
