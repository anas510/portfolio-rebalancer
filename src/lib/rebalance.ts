// ---------------------------------------------------------------------------
// Core rebalancing algorithm  (pure, no I/O -> fully unit-testable)
//
// Given a saved MODEL portfolio (target weights) and the CURRENT portfolio
// (units + prices, incl. a CASH line), compute how many WHOLE shares of each
// stock to buy or sell so the resulting portfolio matches the model.
//
// Cash handling: the PSX portfolio image already includes a CASH line, so cash
// is part of the investable base. An optional `extraCash` lets the user inject
// new money to invest. Because PSX trades whole shares, target units are
// rounded and any rounding remainder simply lands back in cash.
// ---------------------------------------------------------------------------

import type { ActualHolding, ModelHolding, PlanRow, RebalancePlan } from "./types";

export interface RebalanceInput {
  model: ModelHolding[];
  actual: ActualHolding[];
  /** Optional new cash to inject (PKR). Added to the investable base. */
  extraCash?: number;
  /** How to convert a target value into whole shares. */
  rounding?: "nearest" | "floor";
  /**
   * If provided and non-empty, ONLY these symbols are traded; every other
   * holding is left untouched (HOLD). Omit (or empty) to rebalance everything.
   */
  rebalanceSymbols?: string[];
}

const CASH = "CASH";

/**
 * Market value of a holding. For a stock this is ALWAYS quantity × price — the
 * source of truth — so editing a price always changes the plan. Only the CASH
 * line carries an explicit value.
 */
function holdingValue(h: ActualHolding): number {
  if (h.symbol.toUpperCase() === CASH) return h.value ?? h.quantity ?? 0;
  return (h.quantity || 0) * (h.price || 0);
}

function round(n: number, mode: "nearest" | "floor"): number {
  return mode === "floor" ? Math.floor(n) : Math.round(n);
}

export function rebalance(input: RebalanceInput): RebalancePlan {
  const rounding = input.rounding ?? "nearest";
  const extraCash = input.extraCash ?? 0;
  const warnings: string[] = [];

  // Partial-rebalance set: when non-empty, only these symbols are traded.
  const rebalanceSet = new Set((input.rebalanceSymbols ?? []).map((s) => s.toUpperCase()));
  const partial = rebalanceSet.size > 0;

  // --- Index the current portfolio -----------------------------------------
  const actualBySymbol = new Map<string, ActualHolding>();
  for (const h of input.actual) {
    actualBySymbol.set(h.symbol.toUpperCase(), h);
  }

  // --- Index the model ------------------------------------------------------
  const modelBySymbol = new Map<string, ModelHolding>();
  for (const m of input.model) {
    modelBySymbol.set(m.symbol.toUpperCase(), m);
  }

  const weightSum = input.model.reduce((s, m) => s + m.targetPct, 0);
  if (Math.abs(weightSum - 100) > 0.5) {
    warnings.push(
      `Model target weights sum to ${weightSum.toFixed(2)}%, not 100%. Plan is scaled to the model as given.`
    );
  }

  // --- Totals ---------------------------------------------------------------
  const currentCash = holdingValue(
    input.actual.find((h) => h.symbol.toUpperCase() === CASH) ?? { symbol: CASH, quantity: 0, price: 1, value: 0 }
  );
  const currentValue = input.actual.reduce((s, h) => s + holdingValue(h), 0);
  const investableTotal = currentValue + extraCash;

  // --- Build rows for the union of symbols ----------------------------------
  const symbols = new Set<string>([...modelBySymbol.keys(), ...actualBySymbol.keys()]);

  const rows: PlanRow[] = [];
  for (const symbol of symbols) {
    const model = modelBySymbol.get(symbol);
    const actual = actualBySymbol.get(symbol);
    const targetPct = model?.targetPct ?? 0;
    const targetValue = (investableTotal * targetPct) / 100;

    const isCash = symbol === CASH;
    const price = isCash ? 1 : actual?.price ?? 0;
    const currentUnits = isCash ? holdingValue(actual ?? { symbol, quantity: 0, price: 1 }) : actual?.quantity ?? 0;
    const curValue = actual ? holdingValue(actual) : 0;
    const currentPct = investableTotal > 0 ? (curValue / investableTotal) * 100 : 0;

    // Cash is the residual buffer; we report its target but do not "trade" it.
    if (isCash) {
      rows.push({
        symbol,
        name: model?.name ?? actual?.name ?? "Cash",
        price: 1,
        currentUnits: Math.round(currentUnits),
        currentValue: curValue,
        currentPct,
        targetPct,
        targetValue,
        targetUnits: Math.round(targetValue),
        deltaUnits: 0,
        action: "HOLD",
        cashImpact: 0,
      });
      continue;
    }

    // Partial rebalance: leave non-selected holdings exactly as they are.
    if (partial && !rebalanceSet.has(symbol)) {
      rows.push({
        symbol,
        name: model?.name ?? actual?.name,
        price,
        currentUnits,
        currentValue: curValue,
        currentPct,
        targetPct: currentPct, // no change requested
        targetValue: curValue,
        targetUnits: currentUnits,
        deltaUnits: 0,
        action: "HOLD",
        cashImpact: 0,
      });
      continue;
    }

    const priceMissing = !price || price <= 0;
    if (priceMissing && targetPct > 0) {
      warnings.push(`No price for ${symbol}; cannot size its trade. Enter a price to include it.`);
    }
    if (priceMissing) {
      rows.push({
        symbol,
        name: model?.name ?? actual?.name,
        price: 0,
        currentUnits,
        currentValue: curValue,
        currentPct,
        targetPct,
        targetValue,
        targetUnits: currentUnits,
        deltaUnits: 0,
        action: "HOLD",
        cashImpact: 0,
        priceMissing: true,
      });
      continue;
    }

    const targetUnits = Math.max(0, round(targetValue / price, rounding));
    const deltaUnits = targetUnits - currentUnits;
    const cashImpact = -deltaUnits * price; // buy => negative (cash out), sell => positive
    const action: PlanRow["action"] = deltaUnits > 0 ? "BUY" : deltaUnits < 0 ? "SELL" : "HOLD";

    if (!model && currentUnits > 0) {
      warnings.push(`${symbol} is held but not in the model — plan sells it entirely.`);
    }

    rows.push({
      symbol,
      name: model?.name ?? actual?.name,
      price,
      currentUnits,
      currentValue: curValue,
      currentPct,
      targetPct,
      targetValue,
      targetUnits,
      deltaUnits,
      action,
      cashImpact,
    });
  }

  // Sort: actionable rows first (by absolute cash impact), cash last.
  rows.sort((a, b) => {
    if (a.symbol === CASH) return 1;
    if (b.symbol === CASH) return -1;
    return Math.abs(b.cashImpact) - Math.abs(a.cashImpact);
  });

  // --- Totals / cash reconciliation ----------------------------------------
  const buyCash = rows.filter((r) => r.cashImpact < 0).reduce((s, r) => s + r.cashImpact, 0);
  const sellProceeds = rows.filter((r) => r.cashImpact > 0).reduce((s, r) => s + r.cashImpact, 0);
  const netCashAfter = currentCash + extraCash + buyCash + sellProceeds;
  const cashModel = modelBySymbol.get(CASH);
  const targetCash = (investableTotal * (cashModel?.targetPct ?? 0)) / 100;

  if (netCashAfter < -0.5) {
    warnings.push(
      `Plan needs ${Math.abs(netCashAfter).toLocaleString()} PKR more than available. Reduce buys, add cash, or sell more.`
    );
  }

  return {
    rows,
    totals: {
      currentValue,
      cashAvailable: currentCash + extraCash,
      investableTotal,
      buyCash,
      sellProceeds,
      netCashAfter,
      targetCash,
    },
    warnings,
  };
}
