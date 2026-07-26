import { NextResponse } from "next/server";
import { getEffectiveModel, getSelectedPortfolioId, saveRun } from "@/lib/repo";
import { rebalance } from "@/lib/rebalance";
import { fetchLivePrices } from "@/lib/psx";
import type { ActualHolding, ModelHolding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PlanRequest {
  /** Optional: override the saved model. If omitted, the portfolio's model is used. */
  model?: ModelHolding[];
  actual: ActualHolding[];
  extraCash?: number;
  rounding?: "nearest" | "floor";
  /** If non-empty, only these symbols are traded (partial rebalance). */
  rebalanceSymbols?: string[];
  /** Which portfolio's model to use (defaults to the selected one). */
  portfolioId?: number;
  /** Try to enrich missing prices from PSX live data. */
  useLivePrices?: boolean;
  /** Persist this run to history. */
  save?: boolean;
}

/** POST /api/plan -> compute a rebalancing plan. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlanRequest;

    let model = body.model;
    if (!model || model.length === 0) {
      const id = body.portfolioId ?? (await getSelectedPortfolioId());
      const saved = await getEffectiveModel(id);
      if (!saved) {
        return NextResponse.json(
          { error: "No model portfolio saved. Upload/enter and save one first." },
          { status: 400 }
        );
      }
      model = saved.holdings;
    }

    const actual = [...(body.actual ?? [])];
    if (actual.length === 0) {
      return NextResponse.json({ error: "No current holdings provided." }, { status: 400 });
    }

    // Optionally fill in missing prices from live PSX data (best-effort).
    if (body.useLivePrices) {
      const needing = actual.filter((h) => h.symbol.toUpperCase() !== "CASH" && (!h.price || h.price <= 0));
      const modelOnly = model
        .filter((m) => m.symbol.toUpperCase() !== "CASH" && !actual.some((a) => a.symbol.toUpperCase() === m.symbol.toUpperCase()))
        .map((m) => ({ symbol: m.symbol, name: m.name, quantity: 0, price: 0 } as ActualHolding));
      const wanted = [...needing, ...modelOnly].map((h) => h.symbol);
      if (wanted.length > 0) {
        const live = await fetchLivePrices(wanted);
        for (const h of needing) {
          const p = live.get(h.symbol.toUpperCase());
          if (p) h.price = p;
        }
        for (const mh of modelOnly) {
          const p = live.get(mh.symbol.toUpperCase());
          if (p) actual.push({ ...mh, price: p });
        }
      }
    }

    const plan = rebalance({
      model,
      actual,
      extraCash: body.extraCash ?? 0,
      rounding: body.rounding ?? "nearest",
      rebalanceSymbols: body.rebalanceSymbols ?? [],
    });

    if (body.save) {
      await saveRun(plan.totals.cashAvailable, plan.totals.investableTotal, JSON.stringify(plan));
    }

    return NextResponse.json({ plan });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
