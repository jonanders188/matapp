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

export async function GET(request: Request) {
  const token = cleanToken(new URL(request.url).searchParams.get("token"));
  if (!token) return NextResponse.json({ error: "Token mangler" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("household_invitations")
    .select("id, household_id, email, display_name, role, status, expires_at, households(name)")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("[api/household/invitations/accept] GET", error);
    return NextResponse.json({ error: "Kunne ikke hente invitasjonen" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Invitasjonen finnes ikke" }, { status: 404 });

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const expired = Boolean(expiresAt && expiresAt < Date.now());

  return NextResponse.json({
    data: {
      id: data.id,
      email: data.email,
      display_name: data.display_name,
      status: expired ? "expired" : data.status,
      expires_at: data.expires_at,
      household_id: data.household_id,
      household_name: Array.isArray(data.households) ? data.households[0]?.name : (data.households as { name?: string } | null)?.name
    }
  });
}

export async function POST(request: Request) {
  const accessToken = readBearerToken(request);
  if (!accessToken) return NextResponse.json({ error: "Logg inn for å godkjenne invitasjonen" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { token?: unknown };
  const token = cleanToken(body.token);
  if (!token) return NextResponse.json({ error: "Token mangler" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userResult.user?.email) {
    return NextResponse.json({ error: "Ugyldig eller utløpt session" }, { status: 401 });
  }

  const userEmail = userResult.user.email.trim().toLowerCase();

  const { data: invitation, error: invitationError } = await supabase
    .from("household_invitations")
    .select("id, household_id, email, display_name, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (invitationError) {
    console.error("[api/household/invitations/accept] POST", invitationError);
    return NextResponse.json({ error: "Kunne ikke hente invitasjonen" }, { status: 500 });
  }
  if (!invitation) return NextResponse.json({ error: "Invitasjonen finnes ikke" }, { status: 404 });
  if (String(invitation.email ?? "").trim().toLowerCase() !== userEmail) {
    return NextResponse.json({ error: `Invitasjonen gjelder ${invitation.email}. Logg inn med riktig e-post.` }, { status: 409 });
  }
  if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invitasjonen er utløpt. Be om ny invitasjon." }, { status: 410 });
  }

  const role = invitation.role === "admin" ? "admin" : "member";
  const displayName = String(invitation.display_name ?? "").trim() || userEmail.split("@")[0] || userEmail;

  const { data: existingMembership, error: existingError } = await supabase
    .from("household_members")
    .select("id")
    .eq("household_id", invitation.household_id)
    .eq("user_id", userResult.user.id)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existingMembership?.id) {
    const { error: updateError } = await supabase
      .from("household_members")
      .update({ display_name: displayName, role })
      .eq("id", existingMembership.id);
    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase
      .from("household_members")
      .insert({ household_id: invitation.household_id, user_id: userResult.user.id, display_name: displayName, role });
    if (insertError) throw insertError;
  }

  const { error: acceptedError } = await supabase
    .from("household_invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by_user_id: userResult.user.id, updated_at: new Date().toISOString() })
    .eq("id", invitation.id);
  if (acceptedError) throw acceptedError;

  return NextResponse.json({ data: { household_id: invitation.household_id, role } });
}
