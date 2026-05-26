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

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeToken(value: unknown) {
  return decodeURIComponent(String(value ?? "")).trim();
}

async function authenticatedUser(request: Request) {
  const accessToken = readBearerToken(request);
  if (!accessToken) throw apiError("Logg inn for å godkjenne invitasjonen", 401);

  const supabase = getSupabaseAdmin();
  const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userResult.user?.id || !userResult.user.email) {
    throw apiError("Ugyldig eller utløpt innlogging", 401);
  }

  return {
    id: userResult.user.id,
    email: normalizeEmail(userResult.user.email)
  };
}

async function loadInvitationByToken(token: string) {
  const supabase = getSupabaseAdmin();
  const { data: invitation, error } = await supabase
    .from("household_invitations")
    .select("id, household_id, email, display_name, role, status, expires_at, households(name)")
    .eq("token", token)
    .maybeSingle();

  if (error) throw error;
  if (!invitation) {
    throw apiError("Invitasjonen finnes ikke. Be om en ny invitasjon og bruk den nyeste e-posten.", 404);
  }

  return invitation as {
    id: string;
    household_id: string;
    email: string;
    display_name: string | null;
    role: string | null;
    status: string | null;
    expires_at: string | null;
    households?: { name?: string | null } | { name?: string | null }[] | null;
  };
}

function householdName(invitation: { households?: { name?: string | null } | { name?: string | null }[] | null }) {
  const value = Array.isArray(invitation.households) ? invitation.households[0]?.name : invitation.households?.name;
  return String(value ?? "husholdningen").trim() || "husholdningen";
}

function invitationIsExpired(invitation: { expires_at?: string | null }) {
  return Boolean(invitation.expires_at && new Date(String(invitation.expires_at)).getTime() < Date.now());
}

async function ensureMembership(params: {
  householdId: string;
  userId: string;
  displayName: string;
  role: string;
}) {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: existingError } = await supabase
    .from("household_members")
    .select("id, household_id, user_id, display_name, role")
    .eq("household_id", params.householdId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const { data: updated, error: updateError } = await supabase
      .from("household_members")
      .update({
        display_name: existing.display_name || params.displayName,
        role: existing.role || params.role
      })
      .eq("id", existing.id)
      .select("id, household_id, user_id, display_name, role")
      .single();

    if (updateError) throw updateError;
    return updated;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("household_members")
    .insert({
      household_id: params.householdId,
      user_id: params.userId,
      display_name: params.displayName,
      role: params.role
    })
    .select("id, household_id, user_id, display_name, role")
    .single();

  if (insertError) throw insertError;
  return inserted;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = normalizeToken(url.searchParams.get("token"));
    if (!token) throw apiError("Invitasjonslenken mangler token", 400);

    const invitation = await loadInvitationByToken(token);
    const expired = invitationIsExpired(invitation);

    if (expired && String(invitation.status ?? "pending") === "pending") {
      await getSupabaseAdmin()
        .from("household_invitations")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", invitation.id)
        .eq("status", "pending");
    }

    return NextResponse.json({
      data: {
        id: invitation.id,
        household_id: invitation.household_id,
        household_name: householdName(invitation),
        invited_email: normalizeEmail(invitation.email),
        display_name: invitation.display_name,
        status: expired ? "expired" : String(invitation.status ?? "pending"),
        expires_at: invitation.expires_at
      }
    });
  } catch (error) {
    console.error("[api/household-invitations/accept] GET", error);
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    const body = (await request.json()) as { token?: unknown };
    const token = normalizeToken(body.token);
    if (!token) throw apiError("Invitasjonslenken mangler token", 400);

    const supabase = getSupabaseAdmin();
    const invitation = await loadInvitationByToken(token);

    const invitedEmail = normalizeEmail(invitation.email);
    if (invitedEmail !== user.email) {
      throw apiError(`Denne invitasjonen gjelder ${invitedEmail}. Du er logget inn som ${user.email}. Logg ut og inn med riktig e-post.`, 403);
    }

    if (invitationIsExpired(invitation)) {
      await supabase
        .from("household_invitations")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", invitation.id)
        .eq("status", "pending");
      throw apiError("Invitasjonen er utløpt. Be om ny invitasjon.", 410);
    }

    const status = String(invitation.status ?? "pending");
    if (status !== "pending" && status !== "accepted") {
      throw apiError("Invitasjonen er ikke aktiv lenger. Be om ny invitasjon.", 410);
    }

    const role = ["admin", "member", "child"].includes(String(invitation.role)) ? String(invitation.role) : "member";
    const displayName = String(invitation.display_name ?? "").trim() || user.email.split("@")[0] || user.email;

    // Ikke bruk upsert her. Hvis unik constraint mangler eller er ulik mellom miljøer,
    // kan upsert feile stille i flyten. Vi sjekker og oppretter/oppdaterer eksplisitt.
    const member = await ensureMembership({
      householdId: invitation.household_id,
      userId: user.id,
      displayName,
      role
    });

    const { error: updateError } = await supabase
      .from("household_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", invitation.id);

    if (updateError) throw updateError;

    return NextResponse.json({ data: { ...member, accepted: true, alreadyAccepted: status === "accepted" } });
  } catch (error) {
    console.error("[api/household-invitations/accept] POST", error);
    return errorResponse(error);
  }
}
