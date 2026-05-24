import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export type SystemAdminUser = {
  userId: string;
  email: string | null;
};

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function systemAdminErrorResponse(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status) || 500
      : 500;

  const message = error instanceof Error ? error.message : "Ukjent feil";
  return NextResponse.json({ error: message }, { status });
}

function authError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export async function requireSystemAdmin(request: Request): Promise<SystemAdminUser> {
  const token = readBearerToken(request);
  const expectedSecret = process.env.CRON_SECRET || process.env.ADMIN_SECRET;

  if (!token) {
    throw authError("Ikke innlogget", 401);
  }

  if (expectedSecret && token === expectedSecret) {
    return { userId: "00000000-0000-0000-0000-000000000000", email: "service-admin" };
  }

  const supabase = getSupabaseAdmin();

  const { data: userResult, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userResult.user) {
    console.error("[requireSystemAdmin] token validation failed", userError);
    throw authError("Ugyldig eller utløpt session", 401);
  }

  const { data: systemAdmin, error: adminError } = await supabase
    .from("system_admins")
    .select("user_id, email")
    .eq("user_id", userResult.user.id)
    .limit(1)
    .maybeSingle();

  if (adminError) {
    throw adminError;
  }

  if (!systemAdmin) {
    throw authError("System Admin kreves", 403);
  }

  return {
    userId: userResult.user.id,
    email: userResult.user.email ?? systemAdmin.email ?? null
  };
}

export async function isSystemAdmin(request: Request) {
  try {
    const user = await requireSystemAdmin(request);
    return { isSystemAdmin: true, user };
  } catch {
    return { isSystemAdmin: false, user: null };
  }
}
