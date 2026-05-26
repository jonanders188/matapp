import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan invitere medlemmer"), { status: 403 });
  }
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function displayNameFromEmail(email: string) {
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || email;
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
            <div style="margin-top:8px; font-size:14px; color:#64748b;">Ta kontroll på basisvarene.</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0 32px;">
            <h1 style="margin:0; font-size:28px; line-height:1.2; color:#0f172a;">Du er invitert til ${householdName}</h1>
            <p style="font-size:16px; line-height:1.6; color:#334155;">Noen i husholdningen har invitert deg til Matmakt.</p>
            <p style="font-size:16px; line-height:1.6; color:#334155;">Åpne lenken under for å godkjenne invitasjonen. Du blir ikke medlem før du godkjenner selv.</p>
          </td></tr>
          <tr><td style="padding:24px 32px;">
            <a href="${acceptUrl}" style="display:inline-block; background:#16a34a; color:#ffffff; text-decoration:none; font-size:16px; font-weight:700; padding:14px 22px; border-radius:999px;">Godkjenn invitasjon</a>
          </td></tr>
          <tr><td style="padding:0 32px 24px 32px;">
            <p style="font-size:14px; line-height:1.6; color:#64748b;">Alle i husholdningen kan skanne hjemmevarer, bygge basisvarer og bruke felles prisdata.</p>
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
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: `Invitasjon til ${params.householdName} i Matmakt`,
      html: invitationEmailHtml(params),
      text: `Du er invitert til ${params.householdName} i Matmakt. Godkjenn invitasjonen her: ${params.acceptUrl}`
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Object.assign(new Error(`Kunne ikke sende invitasjon via Resend: ${text || response.statusText}`), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireCurrentHousehold(request);
    requireAdminRole(current.role);
    const body = (await request.json()) as { email?: unknown; display_name?: unknown };
    const email = normalizeEmail(body.email);

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Gyldig e-post mangler" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: existingMember, error: memberError } = await supabase
      .from("household_members")
      .select("id")
      .eq("household_id", current.householdId)
      .eq("user_id", current.userId)
      .maybeSingle();
    if (memberError) throw memberError;
    void existingMember;

    const { data: household, error: householdError } = await supabase
      .from("households")
      .select("name")
      .eq("id", current.householdId)
      .single();
    if (householdError) throw householdError;

    const householdName = String(household?.name ?? "husholdningen").trim() || "husholdningen";
    const displayName = String(body.display_name ?? "").trim() || displayNameFromEmail(email);
    const token = inviteToken();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { error: deleteOldInviteError } = await supabase
      .from("household_invitations")
      .delete()
      .eq("household_id", current.householdId)
      .eq("email", email);
    if (deleteOldInviteError) throw deleteOldInviteError;

    const { data: invitation, error: invitationError } = await supabase
      .from("household_invitations")
      .insert({
        household_id: current.householdId,
        email,
        display_name: displayName,
        role: "member",
        token,
        status: "pending",
        invited_by_user_id: current.userId,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .select("id, email, display_name, role, token, status, expires_at, created_at")
      .single();
    if (invitationError) throw invitationError;

    await supabase
      .from("beta_allowed_emails")
      .upsert({ email, note: `Invitert til ${householdName}` }, { onConflict: "email" })
      .then(() => undefined, () => undefined);

    const acceptUrl = `${appOrigin(request)}/invitations/accept?token=${encodeURIComponent(String(invitation.token))}`;
    await sendInvitationEmail({ to: email, householdName, acceptUrl });

    return NextResponse.json({
      data: {
        id: invitation.id,
        email,
        display_name: displayName,
        role: "member",
        status: "invited",
        message: "Invitasjon sendt. Mottaker må godkjenne selv før medlemskap opprettes."
      }
    });
  } catch (error) {
    console.error("[api/admin/members] POST", error);
    return apiErrorResponse(error);
  }
}
