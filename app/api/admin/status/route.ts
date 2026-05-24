import { NextResponse } from "next/server";
import { isSystemAdmin } from "@/lib/system-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const status = await isSystemAdmin(request);
  return NextResponse.json(status);
}
