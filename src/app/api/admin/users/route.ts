import { NextResponse } from "next/server";
import { AuthError, deleteUser, getAdminStats, requireAdmin, setUserBlocked } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/users -> same as stats (user list) */
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

/**
 * POST /api/admin/users { action, userId }
 *  - block    — prevent sign-in, keep data
 *  - unblock  — restore access
 *  - delete   — permanently remove user and all their data
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdmin();
    const body = (await req.json()) as { action?: string; userId?: number };
    const userId = body.userId;
    if (userId == null || !Number.isFinite(userId)) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    switch (body.action) {
      case "block":
        await setUserBlocked(actor, userId, true);
        break;
      case "unblock":
        await setUserBlocked(actor, userId, false);
        break;
      case "delete":
        await deleteUser(actor, userId);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const stats = await getAdminStats();
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
