import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan gjøre dette"), { status: 403 });
  }
}

function toBudget(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function userEmail(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) return null;
  return data.user?.email ?? null;
}

export async function GET(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    const supabase = getSupabaseAdmin();

    const [householdResult, membersResult] = await Promise.all([
      supabase
        .from("households")
        .select("id, name, monthly_budget, created_at")
        .eq("id", current.householdId)
        .single(),
      supabase
        .from("household_members")
        .select("id, household_id, user_id, display_name, role, created_at")
        .eq("household_id", current.householdId)
        .order("created_at", { ascending: true })
    ]);

    if (householdResult.error) throw householdResult.error;
    if (membersResult.error) throw membersResult.error;

    const members = await Promise.all(
      (membersResult.data ?? []).map(async (member) => ({
        ...member,
        email: await userEmail(member.user_id),
        is_current_user: member.user_id === current.userId
      }))
    );

    return NextResponse.json({
      data: {
        household: householdResult.data,
        members,
        currentUserId: current.userId,
        currentRole: current.role
      }
    });
  } catch (error) {
    console.error("[api/admin/household] GET", error);
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const body = (await request.json()) as { name?: unknown; monthly_budget?: unknown };
    const name = String(body.name ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "Husholdningsnavn mangler" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("households")
      .update({
        name,
        monthly_budget: toBudget(body.monthly_budget)
      })
      .eq("id", current.householdId)
      .select("id, name, monthly_budget, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error) {
    console.error("[api/admin/household] PATCH", error);
    return apiErrorResponse(error);
  }
}
