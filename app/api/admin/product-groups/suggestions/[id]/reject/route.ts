import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { createNegativeMatches } from "@/lib/product-group-negative-matches";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireSystemAdmin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const rememberRejectedPairs = body?.rememberRejectedPairs !== false;

    const supabase = getSupabaseAdmin();

    const { data: suggestion, error: suggestionError } = await supabase
      .from("product_group_suggestions")
      .select(`
        id,
        suggested_group_name,
        status,
        product_group_suggestion_members (
          product_id,
          relationship_type
        )
      `)
      .eq("id", id)
      .single();

    if (suggestionError) throw suggestionError;

    let negativeMatchCount = 0;
    if (suggestion.status === "pending" && rememberRejectedPairs) {
      const members = (suggestion.product_group_suggestion_members ?? [])
        .filter((member) => member.relationship_type !== "not_comparable")
        .map((member) => String(member.product_id));

      const negativeMatches = [];
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
          negativeMatches.push({
            productIdA: members[i],
            productIdB: members[j],
            reason: `System Admin avviste hele forslaget "${suggestion.suggested_group_name}".`,
            source: "system_admin_rejected" as const,
            createdBy: admin.userId === "00000000-0000-0000-0000-000000000000" ? null : admin.userId
          });
        }
      }

      const result = await createNegativeMatches(negativeMatches);
      negativeMatchCount = result.count;
    }

    const { error } = await supabase
      .from("product_group_suggestions")
      .update({
        status: "rejected",
        reviewed_by: admin.userId === "00000000-0000-0000-0000-000000000000" ? null : admin.userId,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("status", "pending");

    if (error) throw error;

    return NextResponse.json({ ok: true, negativeMatchCount });
  } catch (error) {
    return systemAdminErrorResponse(error);
  }
}
