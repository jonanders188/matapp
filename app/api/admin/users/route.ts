import { NextResponse } from "next/server";
import { requireSystemAdmin, systemAdminErrorResponse } from "@/lib/system-admin";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HouseholdMemberRow = {
  user_id: string;
  household_id: string;
  role: string | null;
};

type HouseholdRow = {
  id: string;
  name: string | null;
};

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const supabase = getSupabaseAdmin();

    const url = new URL(request.url);
    const query = normalizeEmail(url.searchParams.get("q"));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const perPage = Math.min(200, Math.max(20, Number(url.searchParams.get("per_page") ?? "100") || 100));

    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
      page,
      perPage
    });

    if (authError) throw authError;

    const users = authData.users ?? [];
    const userIds = users.map((user) => user.id);

    let memberships: HouseholdMemberRow[] = [];
    if (userIds.length) {
      const { data: membershipData, error: membershipError } = await supabase
        .from("household_members")
        .select("user_id, household_id, role")
        .in("user_id", userIds);

      if (membershipError) throw membershipError;
      memberships = (membershipData ?? []) as HouseholdMemberRow[];
    }

    const householdIds = [...new Set(memberships.map((membership) => membership.household_id).filter(Boolean))];

    let householdsById = new Map<string, HouseholdRow>();
    if (householdIds.length) {
      const { data: householdsData, error: householdsError } = await supabase
        .from("households")
        .select("id, name")
        .in("id", householdIds);

      if (householdsError) throw householdsError;
      householdsById = new Map(((householdsData ?? []) as HouseholdRow[]).map((household) => [household.id, household]));
    }

    const membershipsByUserId = new Map<string, HouseholdMemberRow[]>();
    for (const membership of memberships) {
      const list = membershipsByUserId.get(membership.user_id) ?? [];
      list.push(membership);
      membershipsByUserId.set(membership.user_id, list);
    }

    const rows = users
      .map((user) => {
        const householdMemberships = (membershipsByUserId.get(user.id) ?? []).map((membership) => ({
          id: membership.household_id,
          name: householdsById.get(membership.household_id)?.name?.trim() || "Hjemme",
          role: membership.role === "admin" ? "admin" : "member"
        }));

        return {
          id: user.id,
          email: normalizeEmail(user.email),
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          confirmed_at: user.confirmed_at,
          household_count: householdMemberships.length,
          households: householdMemberships,
          can_delete: householdMemberships.length === 0
        };
      })
      .filter((user) => !query || user.email.includes(query));

    return NextResponse.json({
      data: {
        users: rows,
        page,
        perPage,
        totalApprox: authData.total ?? rows.length
      }
    });
  } catch (error) {
    console.error("[api/admin/users] GET", error);
    return systemAdminErrorResponse(error);
  }
}
