import { NextResponse } from "next/server";
import { apiErrorResponse, requireCurrentHousehold, type HouseholdRole } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const roles: HouseholdRole[] = ["admin", "member", "child"];

function requireAdminRole(role: string) {
  if (role !== "admin") {
    throw Object.assign(new Error("Kun admin kan gjøre dette"), { status: 403 });
  }
}

function parseRole(value: unknown): HouseholdRole {
  return roles.includes(value as HouseholdRole) ? (value as HouseholdRole) : "member";
}

function randomPassword() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  return `Temp-${random}!`;
}

function displayNameFromEmail(email: string) {
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || email;
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

async function getOrCreateUser(email: string) {
  const supabase = getSupabaseAdmin();
  const existing = await findUserByEmail(email);
  if (existing) return existing;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: true
  });

  if (error) throw error;
  if (!data.user) throw new Error("Kunne ikke opprette Supabase-bruker");

  return data.user;
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
    const user = await getOrCreateUser(email);

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

    return NextResponse.json({ data: { ...data, email: user.email ?? email } });
  } catch (error) {
    console.error("[api/admin/members] POST", error);
    return apiErrorResponse(error);
  }
}
