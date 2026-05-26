import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan endre invitasjoner"), { status: 403 });
  }
}

function inviteToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}${Math.random()}`.replace(/\D/g, "");
}

function appOrigin(request: Request) {
  const origin = request.headers.get("origin")?.trim();
  if (origin?.includes("localhost") || origin?.includes("127.0.0.1")) return origin.replace(/\/$/, "");
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
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
            <div style="font-size:28px; line-height:1.1; font-weight:800; color:#14532d;">Matmakt</div>
            <div style="margin-top:8px; font-size:14px; color:#64748b;">Bygg. Sammenlign. Spar.</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0 32px;">
            <h1 style="margin:0; font-size:28px; line-height:1.2; color:#0f172a;">Du er invitert til ${householdName}</h1>
            <p style="font-size:16px; line-height:1.6; color:#334155;">Noen i husholdningen har invitert deg til Matmakt.</p>
            <p style="font-size:16px; line-height:1.6; color:#334155;">Åpne lenken under for å godkjenne invitasjonen. Du blir ikke medlem av husholdningen før du godkjenner selv.</p>
          </td></tr>
          <tr><td style="padding:24px 32px;">
            <a href="${acceptUrl}" style="display:inline-block; background:#16a34a; color:#ffffff; text-decoration:none; font-size:16px; font-weight:700; padding:14px 22px; border-radius:999px;">Godkjenn invitasjon</a>
          </td></tr>
          <tr><td style="padding:0 32px 24px 32px;">
            <p style="font-size:13px; line-height:1.6; color:#94a3b8;">Hvis knappen ikke virker, kopier og lim inn denne lenken i nettleseren:<br /><span style="word-break:break-all;">${acceptUrl}</span></p>
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
    throw Object.assign(new Error("RESEND_API_KEY mangler. Legg API-nøkkelen fra Resend i .env.local og Vercel env."), { status: 500 });
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || "Matmakt <no-reply@matmakt.no>";
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL?.trim();
  const body: Record<string, unknown> = {
    from,
    to: params.to,
    subject: `Invitasjon til ${params.householdName} i Matmakt`,
    html: invitationEmailHtml(params),
    text: `Du er invitert til ${params.householdName} i Matmakt. Godkjenn invitasjonen her: ${params.acceptUrl}`
  };

  if (replyTo) body.reply_to = replyTo;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Object.assign(new Error(`Kunne ikke sende invitasjon via Resend: ${text || response.statusText}`), { status: 500 });
  }
}

async function loadPendingInvitation(id: string, householdId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("household_invitations")
    .select("id, household_id, email, display_name, role, token, status, expires_at")
    .eq("id", id)
    .eq("household_id", householdId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw Object.assign(new Error("Invitasjonen finnes ikke"), { status: 404 });
  }
  if (String(data.status ?? "") !== "pending") {
    throw Object.assign(new Error("Invitasjonen er ikke aktiv lenger"), { status: 409 });
  }

  return data as {
    id: string;
    household_id: string;
    email: string;
    display_name: string | null;
    role: string | null;
    token: string | null;
    status: string | null;
    expires_at: string | null;
  };
}

async function householdName(householdId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("households")
    .select("name")
    .eq("id", householdId)
    .maybeSingle();

  if (error) throw error;
  return String(data?.name ?? "husholdningen").trim() || "husholdningen";
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const { id } = await context.params;

    const invitation = await loadPendingInvitation(id, current.householdId);
    const token = inviteToken();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const supabase = getSupabaseAdmin();
    const { data: updated, error: updateError } = await supabase
      .from("household_invitations")
      .update({
        token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq("id", invitation.id)
      .eq("household_id", current.householdId)
      .eq("status", "pending")
      .select("id, email, token, expires_at")
      .single();

    if (updateError) throw updateError;

    const name = await householdName(current.householdId);

    await supabase
      .from("beta_allowed_emails")
      .upsert({ email: String(updated.email).toLowerCase(), note: `Invitert til ${name}` }, { onConflict: "email" })
      .then(() => undefined, () => undefined);

    const acceptUrl = `${appOrigin(request)}/invitations/accept?token=${encodeURIComponent(String(updated.token))}`;
    await sendInvitationEmail({ to: String(updated.email), householdName: name, acceptUrl });

    return NextResponse.json({
      data: {
        id: updated.id,
        email: updated.email,
        expires_at: updated.expires_at,
        message: `Ny invitasjon er sendt til ${updated.email}.`
      }
    });
  } catch (error) {
    console.error("[api/admin/invitations/[id]] PATCH", error);
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const { id } = await context.params;

    const invitation = await loadPendingInvitation(id, current.householdId);
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("household_invitations")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString()
      })
      .eq("id", invitation.id)
      .eq("household_id", current.householdId)
      .eq("status", "pending");

    if (error) throw error;

    return NextResponse.json({
      data: {
        id: invitation.id,
        email: invitation.email,
        message: `Invitasjonen til ${invitation.email} er avbrutt.`
      }
    });
  } catch (error) {
    console.error("[api/admin/invitations/[id]] DELETE", error);
    return apiErrorResponse(error);
  }
}
