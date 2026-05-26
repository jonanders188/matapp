import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser, type HouseholdRole } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HouseholdMemberRow = {
  household_id: string;
  role: string | null;
  display_name: string | null;
  created_at?: string | null;
};

type HouseholdRow = {
  id: string;
  name: string | null;
};

function normalizeRole(role: string | null | undefined): HouseholdRole {
  if (role === "admin") return "admin";
  // Barn og medlem behandles likt foreløpig.
  return "member";
}

function requestedHouseholdId(request: Request) {
  const fromHeader = request.headers.get("x-matmakt-household-id")?.trim();
  if (fromHeader) return fromHeader;

  try {
    const url = new URL(request.url);
    return url.searchParams.get("household_id")?.trim() || null;
  } catch {
    return null;
  }
}

function displayNameFromEmail(email: string | null) {
  if (!email) return "Eier";
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Eier";
}

function defaultHouseholdName(email: string | null) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return normalized ? `${normalized} Home` : "Hjemme";
}

async function createDefaultHouseholdForUser(user: { userId: string; email: string | null }) {
  const supabase = getSupabaseAdmin();

  const { data: household, error: householdError } = await supabase
    .from("households")
    // Standardnavn er lett å kjenne igjen i admin, men kan endres av Eier/admin.
      .insert({ name: defaultHouseholdName(user.email), monthly_budget: 0 })
    .select("id, name")
    .single();

  if (householdError) throw householdError;

  const { error: memberError } = await supabase
    .from("household_members")
    .insert({
      household_id: household.id,
      user_id: user.userId,
      display_name: displayNameFromEmail(user.email),
      role: "admin"
    });

  if (memberError) throw memberError;

  return {
    household_id: household.id,
    role: "admin",
    display_name: displayNameFromEmail(user.email),
    created_at: new Date().toISOString()
  } satisfies HouseholdMemberRow;
}

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const supabase = getSupabaseAdmin();
    const selectedHouseholdId = requestedHouseholdId(request);

    const { data: membershipsRaw, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id, role, display_name, created_at")
      .eq("user_id", user.userId)
      .order("created_at", { ascending: true });

    if (membershipError) throw membershipError;

    let memberships = (membershipsRaw ?? []) as HouseholdMemberRow[];

    // Første gang en registrert bruker logger inn uten husholdning,
    // oppretter vi en standard "Hjemme"-husholdning og gjør brukeren til Eier/admin.
    if (memberships.length === 0) {
      const createdMembership = await createDefaultHouseholdForUser(user);
      memberships = [createdMembership];
    }

    const householdIds = [...new Set(memberships.map((membership) => membership.household_id).filter(Boolean))];

    let householdById = new Map<string, HouseholdRow>();
    if (householdIds.length) {
      const { data: householdsRaw, error: householdsError } = await supabase
        .from("households")
        .select("id, name")
        .in("id", householdIds);

      if (householdsError) throw householdsError;
      householdById = new Map(((householdsRaw ?? []) as HouseholdRow[]).map((household) => [household.id, household]));
    }

    const households = memberships.map((membership) => {
      const household = householdById.get(membership.household_id);
      return {
        id: membership.household_id,
        name: household?.name?.trim() || "Hjemme",
        role: normalizeRole(membership.role),
        display_name: membership.display_name ?? null
      };
    });

    const selectedMembership = selectedHouseholdId
      ? households.find((household) => household.id === selectedHouseholdId) ?? households[0] ?? null
      : households[0] ?? null;

    const requestedHouseholdWasInvalid = Boolean(
      selectedHouseholdId && !households.some((household) => household.id === selectedHouseholdId)
    );

    const { data: systemAdmin, error: systemAdminError } = await supabase
      .from("system_admins")
      .select("user_id")
      .eq("user_id", user.userId)
      .limit(1)
      .maybeSingle();

    if (systemAdminError) throw systemAdminError;

    const role = selectedMembership?.role ?? null;
    const isHouseholdAdmin = role === "admin";
    const isSystemAdmin = Boolean(systemAdmin?.user_id);

    return NextResponse.json({
      data: {
        user: {
          id: user.userId,
          email: user.email
        },
        household: selectedMembership,
        households,
        requestedHouseholdWasInvalid,
        capabilities: {
          canUseApp: Boolean(selectedMembership?.id),
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
