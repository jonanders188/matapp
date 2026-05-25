import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function displayNameFromEmail(email: string | null) {
  if (!email) return "Eier";
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Eier";
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

    let membershipQuery = supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", user.userId);

    if (selectedHouseholdId) {
      membershipQuery = membershipQuery.eq("household_id", selectedHouseholdId);
    }

    const { data: memberships, error: existingError } = await membershipQuery
      .order("created_at", { ascending: true })
      .limit(1);

    if (existingError) throw existingError;

    const existing = memberships?.[0] ?? null;

    if (existing?.household_id) {
      return NextResponse.json({
        data: {
          household_id: existing.household_id,
          role: existing.role ?? "member",
          created: false
        }
      });
    }

    if (selectedHouseholdId) {
      return NextResponse.json(
        { error: "Invitasjonen er ikke gyldig for denne e-posten, eller du er ikke medlem av valgt husholdning." },
        { status: 403 }
      );
    }

    const { data: household, error: householdError } = await supabase
      .from("households")
      .insert({ name: "Hjemme", monthly_budget: 0 })
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
        created: true
      }
    });
  } catch (error) {
    console.error("[api/onboarding/ensure-household] POST", error);
    return apiErrorResponse(error);
  }
}
