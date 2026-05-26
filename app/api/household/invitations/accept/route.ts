import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function cleanToken(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function displayNameFromEmail(email: string) {
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || email;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function invitationExpired(expiresAt: string | null | undefined) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
}

type InvitationRow = {
  id: string;
  household_id: string;
  email: string;
  display_name: string | null;
  role: string | null;
  status: string | null;
  expires_at: string | null;
  households?: { name?: string | null } | { name?: string | null }[] | null;
};

function householdNameFromInvitation(invitation: InvitationRow) {
  const households = invitation.households;
  if (Array.isArray(households)) return households[0]?.name ?? null;
  return households?.name ?? null;
}

export async function GET(request: Request) {
  try {
    const token = cleanToken(new URL(request.url).searchParams.get("token"));
    if (!token) return jsonError("Token mangler", 400);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("household_invitations")
      .select("id, household_id, email, display_name, role, status, expires_at, households(name)")
      .eq("token", token)
      .maybeSingle<InvitationRow>();

    if (error) {
      console.error("[api/household/invitations/accept] GET", error);
      return jsonError("Kunne ikke hente invitasjonen", 500);
    }

    if (!data) return jsonError("Invitasjonen finnes ikke. Be om en ny invitasjon.", 404);

    const expired = invitationExpired(data.expires_at);
    const status = expired ? "expired" : (data.status ?? "pending");

    return NextResponse.json({
      data: {
        id: data.id,
        email: normalizeEmail(data.email),
        display_name: data.display_name,
        status,
        expires_at: data.expires_at,
        household_id: data.household_id,
        household_name: householdNameFromInvitation(data)
      }
    });
  } catch (error) {
    console.error("[api/household/invitations/accept] GET unexpected", error);
    return jsonError("Kunne ikke hente invitasjonen", 500);
  }
}

export async function POST(request: Request) {
  try {
    const accessToken = readBearerToken(request);
    if (!accessToken) return jsonError("Logg inn for å godkjenne invitasjonen", 401);

    const body = await request.json().catch(() => ({})) as { token?: unknown };
    const token = cleanToken(body.token);
    if (!token) return jsonError("Token mangler", 400);

    const supabase = getSupabaseAdmin();

    const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userResult.user?.email) {
      return jsonError("Ugyldig eller utløpt session. Logg inn på nytt.", 401);
    }

    const userEmail = normalizeEmail(userResult.user.email);

    const { data: invitation, error: invitationError } = await supabase
      .from("household_invitations")
      .select("id, household_id, email, display_name, role, status, expires_at, accepted_by_user_id")
      .eq("token", token)
      .maybeSingle();

    if (invitationError) {
      console.error("[api/household/invitations/accept] POST lookup", invitationError);
      return jsonError("Kunne ikke hente invitasjonen", 500);
    }

    if (!invitation) return jsonError("Invitasjonen finnes ikke. Be om en ny invitasjon.", 404);

    const invitationEmail = normalizeEmail(invitation.email);
    if (invitationEmail !== userEmail) {
      return jsonError(`Invitasjonen gjelder ${invitation.email}. Logg inn med riktig e-post.`, 409);
    }

    if (invitationExpired(invitation.expires_at)) {
      await supabase
        .from("household_invitations")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", invitation.id)
        .eq("status", "pending")
        .then(() => undefined, () => undefined);

      return jsonError("Invitasjonen er utløpt. Be om ny invitasjon.", 410);
    }

    const status = String(invitation.status ?? "pending");
    if (status === "cancelled") {
      return jsonError("Invitasjonen er avbrutt. Be om en ny invitasjon.", 409);
    }

    if (status !== "pending" && status !== "accepted") {
      return jsonError("Invitasjonen kan ikke godkjennes lenger. Be om ny invitasjon.", 409);
    }

    const role = invitation.role === "admin" ? "admin" : "member";
    const displayName = String(invitation.display_name ?? "").trim() || displayNameFromEmail(userEmail);

    const { data: existingMembership, error: existingError } = await supabase
      .from("household_members")
      .select("id")
      .eq("household_id", invitation.household_id)
      .eq("user_id", userResult.user.id)
      .maybeSingle();

    if (existingError) {
      console.error("[api/household/invitations/accept] membership lookup", existingError);
      return jsonError("Kunne ikke sjekke medlemskap", 500);
    }

    if (existingMembership?.id) {
      const { error: updateError } = await supabase
        .from("household_members")
        .update({ display_name: displayName, role })
        .eq("id", existingMembership.id);

      if (updateError) {
        console.error("[api/household/invitations/accept] membership update", updateError);
        return jsonError("Kunne ikke aktivere medlemskapet", 500);
      }
    } else {
      const { error: insertError } = await supabase
        .from("household_members")
        .insert({
          household_id: invitation.household_id,
          user_id: userResult.user.id,
          display_name: displayName,
          role
        });

      if (insertError) {
        if (insertError.code === "23505") {
          const { error: repairError } = await supabase
            .from("household_members")
            .update({ display_name: displayName, role })
            .eq("household_id", invitation.household_id)
            .eq("user_id", userResult.user.id);

          if (repairError) {
            console.error("[api/household/invitations/accept] membership repair", repairError);
            return jsonError("Kunne ikke aktivere medlemskapet", 500);
          }
        } else {
          console.error("[api/household/invitations/accept] membership insert", insertError);
          return jsonError("Kunne ikke aktivere medlemskapet", 500);
        }
      }
    }

    const { error: acceptedError } = await supabase
      .from("household_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by_user_id: userResult.user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", invitation.id);

    if (acceptedError) {
      console.error("[api/household/invitations/accept] invitation update", acceptedError);
      return jsonError("Medlemskapet ble aktivert, men invitasjonsstatus kunne ikke oppdateres", 500);
    }

    return NextResponse.json({
      data: {
        household_id: invitation.household_id,
        role,
        email: userEmail
      },
      message: "Invitasjonen er godkjent."
    });
  } catch (error) {
    console.error("[api/household/invitations/accept] POST unexpected", error);
    return jsonError("Kunne ikke godkjenne invitasjonen", 500);
  }
}
