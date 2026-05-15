import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold, type HouseholdRole } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const roles: HouseholdRole[] = ["admin", "member", "child"];

type RouteContext = {
  params: Promise<{ id: string }>;
};

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan gjøre dette"), { status: 403 });
  }
}

function parseRole(value: unknown): HouseholdRole | null {
  if (value === undefined || value === null || value === "") return null;
  return roles.includes(value as HouseholdRole) ? (value as HouseholdRole) : null;
}

async function getMember(id: string, householdId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("household_members")
    .select("id, household_id, user_id, display_name, role")
    .eq("id", id)
    .eq("household_id", householdId)
    .single();

  if (error) throw error;
  return data;
}

async function adminCount(householdId: string) {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("household_members")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("role", "admin");

  if (error) throw error;
  return count ?? 0;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const { id } = await context.params;
    const body = (await request.json()) as { display_name?: unknown; role?: unknown };
    const role = parseRole(body.role);
    const displayName = body.display_name === undefined ? undefined : String(body.display_name ?? "").trim();

    if (body.role !== undefined && !role) {
      return NextResponse.json({ error: "Ugyldig rolle" }, { status: 400 });
    }

    const member = await getMember(id, current.householdId);

    if (member.user_id === current.userId && role && role !== "admin") {
      return NextResponse.json({ error: "Du kan ikke fjerne admin fra deg selv" }, { status: 400 });
    }

    if (member.role === "admin" && role && role !== "admin" && (await adminCount(current.householdId)) <= 1) {
      return NextResponse.json({ error: "Husholdningen må ha minst én admin" }, { status: 400 });
    }

    const updates: Record<string, string> = {};
    if (displayName !== undefined) updates.display_name = displayName || member.display_name;
    if (role) updates.role = role;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("household_members")
      .update(updates)
      .eq("id", id)
      .eq("household_id", current.householdId)
      .select("id, household_id, user_id, display_name, role, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error) {
    console.error("[api/admin/members/[id]] PATCH", error);
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const { id } = await context.params;
    const member = await getMember(id, current.householdId);

    if (member.user_id === current.userId) {
      return NextResponse.json({ error: "Du kan ikke fjerne deg selv fra husholdningen" }, { status: 400 });
    }

    if (member.role === "admin" && (await adminCount(current.householdId)) <= 1) {
      return NextResponse.json({ error: "Husholdningen må ha minst én admin" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("household_members")
      .delete()
      .eq("id", id)
      .eq("household_id", current.householdId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/admin/members/[id]] DELETE", error);
    return apiErrorResponse(error);
  }
}
