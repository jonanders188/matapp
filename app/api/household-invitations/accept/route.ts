import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function apiError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function errorResponse(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) || 500
    : 500;
  const message = error instanceof Error ? error.message : "Ukjent feil";
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const accessToken = readBearerToken(request);
    if (!accessToken) throw apiError("Logg inn for aa godkjenne invitasjonen", 401);

    const supabase = getSupabaseAdmin();
    const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userResult.user?.email) throw apiError("Ugyldig eller utloept innlogging", 401);

    const body = (await request.json()) as { token?: unknown };
    const token = String(body.token ?? "").trim();
    if (!token) throw apiError("Invitasjonslenken mangler token", 400);

    const { data: invitation, error: invitationError } = await supabase
      .from("household_invitations")
      .select("id, household_id, email, display_name, role, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (invitationError) throw invitationError;
    if (!invitation) throw apiError("Invitasjonen finnes ikke eller er utloept", 404);
    if (String(invitation.status ?? "pending") !== "pending") throw apiError("Invitasjonen er allerede brukt", 409);
    if (invitation.expires_at && new Date(String(invitation.expires_at)).getTime() < Date.now()) {
      throw apiError("Invitasjonen er utloept", 410);
    }

    const invitedEmail = String(invitation.email ?? "").trim().toLowerCase();
    const userEmail = userResult.user.email.trim().toLowerCase();
    if (invitedEmail !== userEmail) {
      throw apiError(`Denne invitasjonen gjelder ${invitedEmail}. Du er logget inn som ${userEmail}.`, 403);
    }

    const role = ["admin", "member", "child"].includes(String(invitation.role)) ? String(invitation.role) : "member";
    const displayName = String(invitation.display_name ?? "").trim() || userEmail.split("@")[0] || userEmail;

    const { data: member, error: memberError } = await supabase
      .from("household_members")
      .upsert(
        {
          household_id: invitation.household_id,
          user_id: userResult.user.id,
          display_name: displayName,
          role
        },
        { onConflict: "household_id,user_id" }
      )
      .select("id, household_id, user_id, display_name, role")
      .single();

    if (memberError) throw memberError;

    const { error: updateError } = await supabase
      .from("household_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", invitation.id);

    if (updateError) throw updateError;

    return NextResponse.json({ data: member });
  } catch (error) {
    console.error("[api/household-invitations/accept] POST", error);
    return errorResponse(error);
  }
}
