import { getSupabaseAdmin } from "@/lib/supabase-server";

export type HouseholdRole = "admin" | "member" | "child";

export type CurrentHousehold = {
  userId: string;
  householdId: string;
  role: HouseholdRole;
};

export type AuthenticatedUser = {
  userId: string;
  email: string | null;
};

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function authError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}


function normalizeEmailForBeta(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function betaClosedEnabled() {
  return process.env.MATMAKT_BETA_CLOSED === "true";
}

export async function assertBetaAccessForEmail(email: string | null | undefined) {
  if (!betaClosedEnabled()) return;

  const normalized = normalizeEmailForBeta(email);
  if (!normalized || !normalized.includes("@")) {
    throw authError("Matmakt er i lukket beta. Bruk en godkjent e-postadresse.", 403);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("beta_allowed_emails")
    .select("email")
    .eq("email", normalized)
    .maybeSingle();

  if (error) {
    console.error("[assertBetaAccessForEmail] allowlist lookup failed", error);
    throw authError("Kunne ikke sjekke beta-tilgang", 500);
  }

  if (!data?.email) {
    await supabase
      .from("beta_waitlist_emails")
      .upsert({ email: normalized, source: "login-blocked" }, { onConflict: "email" });
    throw authError("Matmakt er i lukket beta. Denne e-postadressen har ikke tilgang ennå.", 403);
  }
}

export async function requireAuthenticatedUser(request: Request): Promise<AuthenticatedUser> {
  const accessToken = readBearerToken(request);

  if (!accessToken) {
    throw authError("Ikke innlogget", 401);
  }

  const supabase = getSupabaseAdmin();
  const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);

  if (userError || !userResult.user) {
    console.error("[requireAuthenticatedUser] token validation failed", userError);
    throw authError("Ugyldig eller utløpt session", 401);
  }

  await assertBetaAccessForEmail(userResult.user.email ?? null);

  return {
    userId: userResult.user.id,
    email: userResult.user.email ?? null
  };
}

export async function requireCurrentHousehold(request: Request): Promise<CurrentHousehold> {
  const user = await requireAuthenticatedUser(request);
  const supabase = getSupabaseAdmin();

  const { data: memberships, error: membershipError } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", user.userId)
    .limit(1);

  if (membershipError) {
    throw membershipError;
  }

  const membership = memberships?.[0];

  if (!membership?.household_id) {
    throw authError("Brukeren er ikke medlem av en husholdning", 403);
  }

  return {
    userId: user.userId,
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
