import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function displayNameFromEmail(email: string | null) {
  if (!email) return "Eier";
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Eier";
}

function defaultHouseholdName(email: string | null) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return normalized ? `${normalized} Home` : "Hjemme";
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

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const supabase = getSupabaseAdmin();
    const selectedHouseholdId = requestedHouseholdId(request);

    // Ikke la en gammel aktiv husholdning i localStorage blokkere en ny bruker.
    // Vi henter alltid alle medlemskap først, velger valgt husholdning hvis den er gyldig,
    // ellers første reelle medlemskap. Hvis ingen finnes, oppretter vi Hjemme.
    const { data: memberships, error: existingError } = await supabase
      .from("household_members")
      .select("household_id, role, created_at")
      .eq("user_id", user.userId)
      .order("created_at", { ascending: true });

    if (existingError) throw existingError;

    const existingMemberships = memberships ?? [];
    const existing = selectedHouseholdId
      ? existingMemberships.find((membership) => membership.household_id === selectedHouseholdId) ?? existingMemberships[0]
      : existingMemberships[0];

    if (existing?.household_id) {
      return NextResponse.json({
        data: {
          household_id: existing.household_id,
          role: existing.role ?? "member",
          created: false
        }
      });
    }

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

    return NextResponse.json({
      data: {
        household_id: household.id,
        household_name: household.name,
        role: "admin",
        created: true,
        next_action: "update_household"
      }
    });
  } catch (error) {
    console.error("[api/onboarding/ensure-household] POST", error);
    return apiErrorResponse(error);
  }
}
