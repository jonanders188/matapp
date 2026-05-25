import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold, type HouseholdRole } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const roles: HouseholdRole[] = ["admin", "member"];

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan gjøre dette"), { status: 403 });
  }
}

function parseRole(value: unknown): HouseholdRole {
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

async function inviteOrFindUser(email: string, request: Request) {
  const supabase = getSupabaseAdmin();
  const existing = await findUserByEmail(email);
  if (existing) return { user: existing, invited: false };

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appOrigin(request)}/onboarding`,
    data: {
      invited_from: "matmakt_household"
    }
  });

  if (error) throw error;
  if (!data.user) throw new Error("Kunne ikke sende invitasjon");

  return { user: data.user, invited: true };
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
    const { user, invited } = await inviteOrFindUser(email, request);
    await allowInvitedEmailInClosedBeta(email, current.userId);

    const { data, error } = await supabase
      .from("household_members")
      .upsert(
        {
          household_id: current.householdId,
          user_id: user.id,
          display_name: displayName,
          role
        },
        { onConflict: "household_id,user_id" }
      )
      .select("id, household_id, user_id, display_name, role, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({
      data: {
        ...data,
        email: user.email ?? email,
        invited,
        message: invited
          ? "Invitasjon er sendt på e-post. Personen blir medlem når de logger inn."
          : "Medlemmet finnes allerede og er lagt til husholdningen. Be personen logge inn med samme e-post."
      }
    });
  } catch (error) {
    console.error("[api/admin/members] POST", error);
    return apiErrorResponse(error);
  }
}
