import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function jsonError(message: string, status: number, details?: unknown) {
  if (details) console.error("[api/admin/invitations/[id]]", message, details);
  return NextResponse.json({ error: message }, { status });
}

function inviteToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}${Math.random()}`.replace(/\D/g, "");
}

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const origin = request.headers.get("origin")?.trim();
  if (origin) return origin.replace(/\/$/, "");
  return "http://localhost:3000";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function invitationEmailHtml(params: { householdName: string; acceptUrl: string }) {
  const householdName = escapeHtml(params.householdName);
  const acceptUrl = escapeHtml(params.acceptUrl);
  return `<!doctype html>
<html lang="no">
  <head><meta charset="utf-8" /><title>Invitasjon til Matmakt</title></head>
  <body style="margin:0; padding:0; background:#f8fafc; font-family:Arial, Helvetica, sans-serif; color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc; padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px; background:#ffffff; border-radius:24px; overflow:hidden; border:1px solid #e2e8f0;">
          <tr><td style="padding:32px 32px 16px 32px;">
            <div style="font-size:26px; line-height:1.1; font-weight:800; color:#14532d;">Matmakt</div>
            <div style="margin-top:8px; font-size:14px; color:#64748b;">Bygg. Sammenlign. Spar.</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0 32px;">
            <h1 style="margin:0; font-size:26px; line-height:1.2; color:#0f172a;">Du er invitert til ${householdName}</h1>
            <p style="font-size:16px; line-height:1.6; color:#334155;">Åpne lenken under for å godkjenne invitasjonen. Du blir ikke medlem før du godkjenner selv.</p>
          </td></tr>
          <tr><td style="padding:24px 32px;">
            <a href="${acceptUrl}" style="display:inline-block; background:#047857; color:#ffffff; text-decoration:none; font-size:16px; font-weight:700; padding:14px 22px; border-radius:999px;">Godkjenn invitasjon</a>
          </td></tr>
          <tr><td style="padding:0 32px 24px 32px;">
            <p style="font-size:13px; line-height:1.6; color:#64748b;">Hvis knappen ikke virker, kopier og lim inn denne lenken i nettleseren:<br /><span style="word-break:break-all;">${acceptUrl}</span></p>
          </td></tr>
          <tr><td style="padding:20px 32px; background:#f1f5f9;">
            <p style="margin:0; font-size:12px; line-height:1.5; color:#64748b;">Du mottar denne e-posten fordi noen inviterte denne e-postadressen til en husholdning i Matmakt.</p>
          </td></tr>
        </table>
        <p style="font-size:12px; color:#94a3b8; margin-top:16px;">matmakt.no</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function sendInvitationEmail(params: { to: string; householdName: string; acceptUrl: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY mangler");
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || "Matmakt <no-reply@matmakt.no>";
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL?.trim();

  const payload: Record<string, unknown> = {
    from,
    to: params.to,
    subject: `Invitasjon til Matmakt`,
    html: invitationEmailHtml(params),
    text: `Du er invitert til ${params.householdName} i Matmakt. Godkjenn invitasjonen her: ${params.acceptUrl}`
  };

  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Kunne ikke sende invitasjon via Resend: ${text || response.statusText}`);
  }
}

async function getAuthenticatedUser(request: Request) {
  const token = readBearerToken(request);
  if (!token) return { error: jsonError("Ikke innlogget", 401) };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { error: jsonError("Ugyldig eller utløpt session", 401, error) };
  }

  return { user: data.user };
}

async function ensureInvitationAdmin(userId: string, invitationId: string) {
  const supabase = getSupabaseAdmin();

  const { data: invitation, error: invitationError } = await supabase
    .from("household_invitations")
    .select("id, household_id, email, display_name, role, status, token, expires_at")
    .eq("id", invitationId)
    .maybeSingle();

  if (invitationError) {
    return { error: jsonError("Kunne ikke hente invitasjonen", 500, invitationError) };
  }

  if (!invitation) {
    return { error: jsonError("Invitasjonen finnes ikke", 404) };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("role")
    .eq("household_id", invitation.household_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    return { error: jsonError("Kunne ikke sjekke admin-tilgang", 500, membershipError) };
  }

  if (membership?.role !== "admin") {
    return { error: jsonError("Kun admin kan håndtere invitasjoner", 403) };
  }

  return { invitation };
}

async function closeIfAlreadyMember(invitation: { id: string; household_id: string; email: string }) {
  const supabase = getSupabaseAdmin();
  const email = String(invitation.email ?? "").trim().toLowerCase();
  if (!email) return false;

  const { data: usersResult, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    console.warn("[api/admin/invitations/[id]] listUsers failed", usersError);
    return false;
  }

  const invitedUser = usersResult.users.find((user) => String(user.email ?? "").trim().toLowerCase() === email);
  if (!invitedUser) return false;

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("id")
    .eq("household_id", invitation.household_id)
    .eq("user_id", invitedUser.id)
    .maybeSingle();

  if (membershipError) {
    console.warn("[api/admin/invitations/[id]] membership lookup failed", membershipError);
    return false;
  }

  if (!membership?.id) return false;

  const now = new Date().toISOString();
  await supabase
    .from("household_invitations")
    .update({
      status: "accepted",
      accepted_user_id: invitedUser.id,
      accepted_at: now,
      updated_at: now
    })
    .eq("id", invitation.id);

  return true;
}

async function handleInvitationAction(request: Request, context: RouteContext, forcedAction?: "resend" | "cancel") {
  try {
    const { id } = await context.params;
    if (!id) return jsonError("Invitasjons-ID mangler", 400);

    const auth = await getAuthenticatedUser(request);
    if ("error" in auth) return auth.error;

    let action = forcedAction;
    if (!action) {
      const body = (await request.json().catch(() => ({}))) as { action?: unknown };
      const requestedAction = String(body.action ?? "").trim();
      if (requestedAction === "resend" || requestedAction === "cancel") action = requestedAction;
    }

    if (action !== "resend" && action !== "cancel") {
      return jsonError("Ukjent invitasjonshandling", 400);
    }

    const access = await ensureInvitationAdmin(auth.user.id, id);
    if ("error" in access) return access.error;

    const invitation = access.invitation;
    const supabase = getSupabaseAdmin();

    if (action === "cancel") {
      if (invitation.status !== "pending") {
        return jsonError("Bare ventende invitasjoner kan avbrytes", 409);
      }

      const { error: updateError } = await supabase
        .from("household_invitations")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", invitation.id)
        .eq("status", "pending");

      if (updateError) return jsonError("Kunne ikke avbryte invitasjonen", 500, updateError);

      return NextResponse.json({ data: { id: invitation.id, status: "cancelled" }, message: "Invitasjonen er avbrutt." });
    }

    const alreadyMember = await closeIfAlreadyMember(invitation);
    if (alreadyMember) {
      return NextResponse.json({ data: { id: invitation.id, status: "accepted" }, message: "Brukeren er allerede medlem. Invitasjonen er lukket." });
    }

    if (invitation.status !== "pending") {
      return jsonError("Invitasjonen er ikke lenger ventende", 409);
    }

    const token = inviteToken();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("household_invitations")
      .update({ token, expires_at: expiresAt, status: "pending", updated_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .eq("status", "pending");

    if (updateError) return jsonError("Kunne ikke oppdatere invitasjonen", 500, updateError);

    const { data: household, error: householdError } = await supabase
      .from("households")
      .select("name")
      .eq("id", invitation.household_id)
      .maybeSingle();

    if (householdError) return jsonError("Kunne ikke hente husholdningen", 500, householdError);

    const householdName = String(household?.name ?? "husholdningen").trim() || "husholdningen";
    const acceptUrl = `${appOrigin(request)}/invitations/accept?token=${encodeURIComponent(token)}`;

    await sendInvitationEmail({ to: String(invitation.email), householdName, acceptUrl });

    return NextResponse.json({
      data: { id: invitation.id, email: invitation.email, status: "pending", expires_at: expiresAt },
      message: "Invitasjonen er sendt på nytt."
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Kunne ikke håndtere invitasjonen", 500, error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleInvitationAction(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return handleInvitationAction(request, context, "resend");
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleInvitationAction(request, context, "cancel");
}
