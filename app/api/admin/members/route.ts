import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold, type HouseholdRole } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const roles: HouseholdRole[] = ["member"];

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan invitere til husholdningen"), { status: 403 });
  }
}

function parseRole(value: unknown): HouseholdRole {
  // Foreløpig inviteres alle nye husholdningsmedlemmer som medlem.
  // Admin kan endre rollen etter at invitasjonen er godtatt.
  return roles.includes(value as HouseholdRole) ? (value as HouseholdRole) : "member";
}

function displayNameFromEmail(email: string) {
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || email;
}

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured?.startsWith("http")) return configured.replace(/\/$/, "");

  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return new URL(request.url).origin;
}

function inviteRedirectUrl(request: Request, householdId: string, token: string) {
  const url = new URL("/onboarding", appOrigin(request));
  url.searchParams.set("invite_token", token);
  url.searchParams.set("household_id", householdId);
  return url.toString();
}

async function allowInvitedEmailInClosedBeta(email: string, invitedBy: string) {
  const supabase = getSupabaseAdmin();
  const normalized = email.trim().toLowerCase();

  // Tabellen finnes først etter closed-beta-patch. Ikke la invitasjon feile i miljøer uten tabellen.
  const { error } = await supabase
    .from("beta_allowed_emails")
    .upsert(
      { email: normalized, note: `Invitert til husholdning av ${invitedBy}` },
      { onConflict: "email" }
    );

  if (error) {
    console.warn("[api/admin/members] could not add invited email to beta allowlist", error);
  }
}

async function findUserByEmail(email: string) {
  const supabase = getSupabaseAdmin();
  const normalized = email.trim().toLowerCase();

  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    const match = data.users.find((user) => user.email?.toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < 1000) break;
  }

  return null;
}

function newInviteToken() {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`.replace(/-/g, "");
}

async function createPendingInvitation(input: {
  householdId: string;
  email: string;
  displayName: string;
  role: HouseholdRole;
  invitedBy: string;
}) {
  const supabase = getSupabaseAdmin();
  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();

  const { data, error } = await supabase
    .from("household_invitations")
    .upsert(
      {
        household_id: input.householdId,
        email: input.email,
        display_name: input.displayName,
        role: input.role,
        invited_by: input.invitedBy,
        token,
        status: "pending",
        expires_at: expiresAt,
        accepted_at: null
      },
      { onConflict: "household_id,email" }
    )
    .select("id, household_id, email, display_name, role, token, status, expires_at, created_at")
    .single();

  if (error) throw error;
  return data;
}

async function sendInvitationEmail(email: string, request: Request, householdId: string, token: string) {
  const supabase = getSupabaseAdmin();
  const redirectTo = inviteRedirectUrl(request, householdId, token);
  const existing = await findUserByEmail(email);

  if (existing) {
    // Eksisterende brukere må fortsatt godkjenne invitasjonen selv.
    // Magic link sender e-post og lander brukeren på invitasjonen.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: false
      }
    });
    if (error) throw error;
    return { existingUser: true, sent: true };
  }

  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      invited_from: "matmakt_household",
      household_id: householdId,
      invite_token: token
    }
  });

  if (error) throw error;
  return { existingUser: false, sent: true };
}

export async function POST(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const body = (await request.json()) as { email?: unknown; display_name?: unknown; role?: unknown };
    const email = String(body.email ?? "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Gyldig e-post mangler" }, { status: 400 });
    }

    const role = parseRole(body.role);
    const displayName = String(body.display_name ?? "").trim() || displayNameFromEmail(email);
    const supabase = getSupabaseAdmin();

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      const { data: existingMembership, error: membershipError } = await supabase
        .from("household_members")
        .select("id")
        .eq("household_id", current.householdId)
        .eq("user_id", existingUser.id)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (existingMembership?.id) {
        return NextResponse.json({
          data: {
            email,
            invited: false,
            alreadyMember: true,
            message: "Brukeren er allerede medlem av denne husholdningen."
          }
        });
      }
    }

    await allowInvitedEmailInClosedBeta(email, current.userId);

    const invitation = await createPendingInvitation({
      householdId: current.householdId,
      email,
      displayName,
      role,
      invitedBy: current.userId
    });

    const mail = await sendInvitationEmail(email, request, current.householdId, invitation.token);

    return NextResponse.json({
      data: {
        id: invitation.id,
        email,
        invited: true,
        existingUser: mail.existingUser,
        message: mail.existingUser
          ? "Invitasjon er sendt. Brukeren må åpne e-posten og godkjenne medlemskap i denne husholdningen."
          : "Invitasjon er sendt på e-post. Personen blir medlem når invitasjonen godkjennes."
      }
    });
  } catch (error) {
    console.error("[api/admin/members] POST", error);
    return apiErrorResponse(error);
  }
}
