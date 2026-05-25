import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function displayNameFromEmail(email: string | null) {
  if (!email) return "Eier";
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Eier";
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const supabase = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", user.userId)
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;

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
