import { requireAdminAccess } from "@/lib/admin-guard";
import { NextResponse } from "next/server";
import { hasKassalappKey } from "@/lib/kassalapp";
import { getSupabaseAdmin, getSupabaseConfigStatus } from "@/lib/supabase-server";
import { adminSecretStatus } from "@/lib/admin-guard";

type TableName =
  | "households"
  | "products"
  | "inventory_items"
  | "price_observations"
  | "product_alternatives";

const TABLES: TableName[] = [
  "households",
  "products",
  "inventory_items",
  "price_observations",
  "product_alternatives"
];

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return "Ukjent feil";
}

async function countTable(table: TableName) {
  const supabase = getSupabaseAdmin();
  const result = await supabase.from(table).select("id", { count: "exact", head: true });
  return {
    table,
    ok: !result.error,
    count: result.count ?? 0,
    error: result.error?.message ?? null
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireAdminAccess(request);
  if (unauthorized) return unauthorized;

  const env = {
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    kassalappConfigured: hasKassalappKey(),
    supabase: getSupabaseConfigStatus(),
    admin: adminSecretStatus()
  };

  try {
    const tables = await Promise.all(TABLES.map((table) => countTable(table)));
    const missingOrBroken = tables.filter((table) => !table.ok).map((table) => table.table);

    return NextResponse.json({
      ok: missingOrBroken.length === 0,
      env,
      tables,
      missingOrBroken,
      nextSteps: [
        "Legg til produkter i basisutvalget",
        "Synk basispriser"
      ],
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        env,
        error: errorMessage(error),
        checkedAt: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
