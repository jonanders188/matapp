import { getSupabaseAdmin } from "@/lib/supabase-server";

export type HouseholdRole = "admin" | "member" | "child";

export type CurrentHousehold = {
  userId: string;
  householdId: string;
  role: HouseholdRole;
};

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function authError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export async function requireCurrentHousehold(request: Request): Promise<CurrentHousehold> {
  const accessToken = readBearerToken(request);

  if (!accessToken) {
    throw authError("Ikke innlogget", 401);
  }

  const supabase = getSupabaseAdmin();

  const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);

  if (userError || !userResult.user) {
    console.error("[requireCurrentHousehold] token validation failed", userError);
    throw authError("Ugyldig eller utløpt session", 401);
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", userResult.user.id)
    .limit(1);

  if (membershipError) {
    throw membershipError;
  }

  const membership = memberships?.[0];

  if (!membership?.household_id) {
    throw authError("Brukeren er ikke medlem av en husholdning", 403);
  }

  return {
    userId: userResult.user.id,
    householdId: membership.household_id,
    role: (membership.role ?? "member") as HouseholdRole
  };
}

export function apiErrorResponse(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status) || 500
      : 500;

  const message = error instanceof Error ? error.message : "Ukjent feil";

  return Response.json({ error: message }, { status });
}
