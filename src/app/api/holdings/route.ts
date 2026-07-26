import { NextResponse } from "next/server";
import { getSelectedPortfolioId, getPortfolioHoldings, savePortfolioHoldings, ForbiddenError } from "@/lib/repo";
import { requireUser } from "@/lib/auth";
import type { ActualHolding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/holdings[?portfolioId=] -> saved holdings for a portfolio. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("portfolioId");
    const id = idParam ? Number(idParam) : await getSelectedPortfolioId(user.id);
    return NextResponse.json({ portfolioId: id, holdings: await getPortfolioHoldings(user.id, id) });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}

/** PUT /api/holdings  { portfolioId?, holdings } -> save snapshot. */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { portfolioId?: number; holdings?: ActualHolding[] };
    const id = body.portfolioId ?? (await getSelectedPortfolioId(user.id));
    await savePortfolioHoldings(user.id, id, body.holdings ?? []);
    return NextResponse.json({ portfolioId: id, holdings: await getPortfolioHoldings(user.id, id) });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
