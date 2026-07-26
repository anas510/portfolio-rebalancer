import { NextResponse } from "next/server";
import {
  listPortfolios,
  getSelectedPortfolioId,
  selectPortfolio,
  createPortfolio,
  renamePortfolio,
  deletePortfolio,
} from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/portfolios -> { portfolios, selectedId } */
export async function GET() {
  try {
    const [portfolios, selectedId] = await Promise.all([listPortfolios(), getSelectedPortfolioId()]);
    return NextResponse.json({ portfolios, selectedId });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
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
    const body = (await req.json()) as { action?: string; id?: number; name?: string };
    switch (body.action) {
      case "create":
        await createPortfolio(body.name ?? "Portfolio");
        break;
      case "select":
        if (body.id != null) await selectPortfolio(body.id);
        break;
      case "rename":
        if (body.id != null) await renamePortfolio(body.id, body.name ?? "Portfolio");
        break;
      case "delete":
        if (body.id != null) await deletePortfolio(body.id);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const [portfolios, selectedId] = await Promise.all([listPortfolios(), getSelectedPortfolioId()]);
    return NextResponse.json({ portfolios, selectedId });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
