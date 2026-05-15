import { NextResponse } from "next/server";
import { hasKassalappKey } from "@/lib/kassalapp";
import { getSupabaseConfigStatus } from "@/lib/supabase-server";
import { adminSecretStatus } from "@/lib/admin-guard";

export async function GET() {
  return NextResponse.json({
    ok: true,
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    kassalappConfigured: hasKassalappKey(),
    supabase: getSupabaseConfigStatus(),
    admin: adminSecretStatus(),
    checkedAt: new Date().toISOString()
  });
}
