import { NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    const token = String(body.token ?? "").trim();

    if (!token) {
      return NextResponse.json({ error: "Invitasjonskode mangler" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: invitation, error: inviteError } = await supabase
      .from("household_invitations")
      .select("id, household_id, email, display_name, role, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invitation?.id) {
      return NextResponse.json({ error: "Invitasjonen finnes ikke eller er utløpt" }, { status: 404 });
    }

    if (normalizeEmail(invitation.email) !== normalizeEmail(user.email)) {
      return NextResponse.json(
        { error: "Denne invitasjonen gjelder en annen e-postadresse. Logg inn med e-posten invitasjonen ble sendt til." },
        { status: 403 }
      );
    }

    if (invitation.status === "accepted") {
      return NextResponse.json({
        data: {
          household_id: invitation.household_id,
          accepted: true,
          alreadyAccepted: true
        }
      });
    }

    if (invitation.status !== "pending") {
      return NextResponse.json({ error: "Invitasjonen er ikke aktiv lenger" }, { status: 410 });
    }

    if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) {
      await supabase
        .from("household_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      return NextResponse.json({ error: "Invitasjonen er utløpt. Be om ny invitasjon." }, { status: 410 });
    }

    const { error: memberError } = await supabase
      .from("household_members")
      .upsert(
        {
          household_id: invitation.household_id,
          user_id: user.userId,
          display_name: invitation.display_name || normalizeEmail(user.email).split("@")[0] || "Medlem",
          role: invitation.role === "admin" ? "admin" : "member"
        },
        { onConflict: "household_id,user_id" }
      );

    if (memberError) throw memberError;

    const { error: updateError } = await supabase
      .from("household_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_user_id: user.userId })
      .eq("id", invitation.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      data: {
        household_id: invitation.household_id,
        accepted: true
      }
    });
  } catch (error) {
    console.error("[api/household/invitations/accept] POST", error);
    return apiErrorResponse(error);
  }
}
