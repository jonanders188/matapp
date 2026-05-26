import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function apiError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function displayNameFromEmail(email: string | null) {
  if (!email) return "Eier";
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Eier";
}

type EnsureUserHouseholdRow = {
  household_id: string;
  household_name: string | null;
  role: string | null;
  created: boolean | null;
};

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const supabase = getSupabaseAdmin();

    // Forstegangsoppretting ma vaere atomisk. DB-funksjonen tar advisory lock per
    // user_id, sjekker eksisterende medlemskap og oppretter bare hvis ingen finnes.
    const { data, error } = await supabase.rpc("ensure_user_household", {
      p_user_id: user.userId,
      p_email: user.email,
      p_display_name: displayNameFromEmail(user.email)
    });

    if (error) {
      if (error.code === "PGRST202" || /ensure_user_household/i.test(error.message ?? "")) {
        throw apiError("Databasefunksjonen ensure_user_household mangler. Kjor supabase/patch-049-atomic-ensure-user-household.sql i riktig Supabase-prosjekt.", 500);
      }
      throw error;
    }

    const rows = (Array.isArray(data) ? data : []) as EnsureUserHouseholdRow[];
    const result = rows[0];
    if (!result?.household_id) {
      throw apiError("Kunne ikke sikre husholdning for brukeren", 500);
    }

    return NextResponse.json({
      data: {
        household_id: result.household_id,
        household_name: result.household_name,
        role: result.role ?? "member",
        created: Boolean(result.created),
        next_action: result.created ? "update_household" : null
      }
    });
  } catch (error) {
    console.error("[api/onboarding/ensure-household] POST", error);
    return apiErrorResponse(error);
  }
}
