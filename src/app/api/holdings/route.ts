import { NextResponse } from "next/server";
import { getSelectedPortfolioId, getPortfolioHoldings, savePortfolioHoldings } from "@/lib/repo";
import type { ActualHolding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/holdings[?portfolioId=] -> saved holdings for a portfolio. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("portfolioId");
    const id = idParam ? Number(idParam) : await getSelectedPortfolioId();
    return NextResponse.json({ portfolioId: id, holdings: await getPortfolioHoldings(id) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** PUT /api/holdings  { portfolioId?, holdings } -> save snapshot. */
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { portfolioId?: number; holdings?: ActualHolding[] };
    const id = body.portfolioId ?? (await getSelectedPortfolioId());
    await savePortfolioHoldings(id, body.holdings ?? []);
    return NextResponse.json({ portfolioId: id, holdings: await getPortfolioHoldings(id) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
