import { NextResponse } from "next/server";
import {
  listPortfolios,
  getSelectedPortfolioId,
  selectPortfolio,
  createPortfolio,
  renamePortfolio,
  deletePortfolio,
  ForbiddenError,
} from "@/lib/repo";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/portfolios -> { portfolios, selectedId } */
export async function GET() {
  try {
    const user = await requireUser();
    const [portfolios, selectedId] = await Promise.all([listPortfolios(user.id), getSelectedPortfolioId(user.id)]);
    return NextResponse.json({ portfolios, selectedId });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}

/**
 * POST /api/portfolios  { action, ... }
 *  - create  { name }
 *  - select  { id }
 *  - rename  { id, name }
 *  - delete  { id }
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { action?: string; id?: number; name?: string };
    switch (body.action) {
      case "create":
        await createPortfolio(user.id, body.name ?? "Portfolio");
        break;
      case "select":
        if (body.id != null) await selectPortfolio(user.id, body.id);
        break;
      case "rename":
        if (body.id != null) await renamePortfolio(user.id, body.id, body.name ?? "Portfolio");
        break;
      case "delete":
        if (body.id != null) await deletePortfolio(user.id, body.id);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const [portfolios, selectedId] = await Promise.all([listPortfolios(user.id), getSelectedPortfolioId(user.id)]);
    return NextResponse.json({ portfolios, selectedId });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
