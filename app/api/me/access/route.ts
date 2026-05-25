import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser, type HouseholdRole } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeRole(role: string | null | undefined): HouseholdRole {
  if (role === "admin") return "admin";
  // Barn og medlem behandles likt foreløpig.
  return "member";
}

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const supabase = getSupabaseAdmin();

    const { data: membership, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id, role, display_name")
      .eq("user_id", user.userId)
      .limit(1)
      .maybeSingle();

    if (membershipError) throw membershipError;

    const { data: systemAdmin, error: systemAdminError } = await supabase
      .from("system_admins")
      .select("user_id")
      .eq("user_id", user.userId)
      .limit(1)
      .maybeSingle();

    if (systemAdminError) throw systemAdminError;

    const role = membership?.household_id ? normalizeRole(membership.role) : null;
    const isHouseholdAdmin = role === "admin";
    const isSystemAdmin = Boolean(systemAdmin?.user_id);

    return NextResponse.json({
      data: {
        user: {
          id: user.userId,
          email: user.email
        },
        household: membership?.household_id
          ? {
              id: membership.household_id,
              role,
              display_name: membership.display_name ?? null
            }
          : null,
        capabilities: {
          canUseApp: Boolean(membership?.household_id),
          canManageHousehold: isHouseholdAdmin,
          canManageMembers: isHouseholdAdmin,
          canManageStores: isHouseholdAdmin,
          canAccessSystemAdmin: isSystemAdmin
        }
      }
    });
  } catch (error) {
    console.error("[api/me/access] GET", error);
    return apiErrorResponse(error);
  }
}
