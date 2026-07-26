import { NextResponse } from "next/server";
import { getEffectiveModel, getSelectedPortfolioId, saveModelForPortfolio } from "@/lib/repo";
import type { ModelHolding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/model[?portfolioId=] -> the effective model for that portfolio. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("portfolioId");
    const id = idParam ? Number(idParam) : await getSelectedPortfolioId();
    const model = await getEffectiveModel(id);
    return NextResponse.json({ model, portfolioId: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/model  { name, holdings, scope?, portfolioId? }
 * scope "default" (shared) or "custom" (this portfolio only). Default: "default".
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      holdings?: ModelHolding[];
      scope?: "default" | "custom";
      portfolioId?: number;
    };
    const holdings = (body.holdings ?? []).filter((h) => h.symbol && h.targetPct > 0);
    if (holdings.length === 0) {
      return NextResponse.json({ error: "No holdings provided." }, { status: 400 });
    }
    const id = body.portfolioId ?? (await getSelectedPortfolioId());
    const model = await saveModelForPortfolio(id, body.name ?? "Model Portfolio", holdings, body.scope ?? "default");
    return NextResponse.json({ model, portfolioId: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
