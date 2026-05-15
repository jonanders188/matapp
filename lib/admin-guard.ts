import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function adminSecretStatus() {
  return {
    configured: Boolean(process.env.CRON_SECRET || process.env.ADMIN_SECRET)
  };
}

export async function requireAdminAccess(request: Request) {
  const token = readBearerToken(request);
  const expectedSecret = process.env.CRON_SECRET || process.env.ADMIN_SECRET;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (expectedSecret && token === expectedSecret) {
    return null;
  }

  const supabase = getSupabaseAdmin();

  const { data: userResult, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userResult.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("role")
    .eq("user_id", userResult.user.id)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membership) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  return null;
}

/**
 * Backwards-compatible alias. Prefer requireAdminAccess().
 */
export async function requireAdminSecret(request: Request) {
  return requireAdminAccess(request);
}
