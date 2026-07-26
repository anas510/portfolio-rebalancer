import { NextResponse } from "next/server";
import { getAdminStats, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/stats */
export async function GET() {
  try {
    await requireAdmin();
    const stats = await getAdminStats();
    return NextResponse.json(stats);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
