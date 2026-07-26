import { describe, it, expect } from "vitest";
import { rebalance } from "@/lib/rebalance";
import type { ActualHolding, ModelHolding } from "@/lib/types";

// A trimmed, realistic PSX example based on the user's screenshots.
const model: ModelHolding[] = [
  { symbol: "FABL", targetPct: 11 },
  { symbol: "TGL", targetPct: 10 },
  { symbol: "DGKC", targetPct: 10 },
  { symbol: "CASH", targetPct: 10 },
];

describe("rebalance", () => {
  it("computes whole-share buys and sells toward target weights", () => {
    const actual: ActualHolding[] = [
      { symbol: "FABL", quantity: 100, price: 100, value: 10000 }, // 10k
      { symbol: "TGL", quantity: 50, price: 180, value: 9000 }, // 9k
      { symbol: "DGKC", quantity: 0, price: 200, value: 0 }, // not held yet
      { symbol: "CASH", quantity: 0, price: 1, value: 5000 }, // 5k cash
    ];
    // investable total = 10000 + 9000 + 0 + 5000 = 24000
    const plan = rebalance({ model, actual });

    const byId = Object.fromEntries(plan.rows.map((r) => [r.symbol, r]));
    expect(plan.totals.investableTotal).toBe(24000);

    // FABL target = 24000 * 11% = 2640 -> 2640/100 = 26 units, delta = 26 - 100 = -74 (SELL)
    expect(byId.FABL.targetUnits).toBe(26);
    expect(byId.FABL.deltaUnits).toBe(-74);
    expect(byId.FABL.action).toBe("SELL");

    // DGKC target = 24000 * 10% = 2400 -> 2400/200 = 12 units, delta = +12 (BUY)
    expect(byId.DGKC.targetUnits).toBe(12);
    expect(byId.DGKC.deltaUnits).toBe(12);
    expect(byId.DGKC.action).toBe("BUY");
  });

  it("supports injecting new cash", () => {
    const actual: ActualHolding[] = [
      { symbol: "FABL", quantity: 0, price: 100, value: 0 },
      { symbol: "CASH", quantity: 0, price: 1, value: 1000 },
    ];
    const plan = rebalance({ model: [{ symbol: "FABL", targetPct: 50 }, { symbol: "CASH", targetPct: 50 }], actual, extraCash: 1000 });
    // investable = 1000 + 1000 = 2000; FABL target = 1000 -> 10 units
    const fabl = plan.rows.find((r) => r.symbol === "FABL")!;
    expect(plan.totals.investableTotal).toBe(2000);
    expect(fabl.targetUnits).toBe(10);
    expect(fabl.action).toBe("BUY");
  });

  it("flags holdings that are not in the model (full sell) and missing prices", () => {
    const actual: ActualHolding[] = [
      { symbol: "XYZ", quantity: 100, price: 5, value: 500 }, // not in model
      { symbol: "DGKC", quantity: 0, price: 0 }, // model symbol, no price
      { symbol: "CASH", quantity: 0, price: 1, value: 500 },
    ];
    const plan = rebalance({ model, actual });
    const xyz = plan.rows.find((r) => r.symbol === "XYZ")!;
    expect(xyz.action).toBe("SELL");
    expect(xyz.targetUnits).toBe(0);
    expect(plan.warnings.some((w) => w.includes("not in the model"))).toBe(true);
    expect(plan.warnings.some((w) => w.toLowerCase().includes("no price"))).toBe(true);
  });

  it("values stocks by quantity × price, ignoring any stale value field", () => {
    const actual: ActualHolding[] = [
      // stale/incorrect value (= price) must NOT be trusted for a stock
      { symbol: "FABL", quantity: 100, price: 100, value: 100 },
      { symbol: "CASH", quantity: 0, price: 1, value: 5000 },
    ];
    const plan = rebalance({ model: [{ symbol: "FABL", targetPct: 50 }, { symbol: "CASH", targetPct: 50 }], actual });
    // FABL should be valued at 100*100 = 10,000 (not 100), so investable = 15,000
    expect(plan.totals.investableTotal).toBe(15000);
    const fabl = plan.rows.find((r) => r.symbol === "FABL")!;
    expect(fabl.currentValue).toBe(10000);
    expect(fabl.currentPct).toBeCloseTo((10000 / 15000) * 100);
  });

  it("partial rebalance trades only selected symbols; others HOLD", () => {
    const actual: ActualHolding[] = [
      { symbol: "FABL", quantity: 100, price: 100 }, // way off target but NOT selected
      { symbol: "DGKC", quantity: 0, price: 200 },
      { symbol: "CASH", quantity: 0, price: 1, value: 5000 },
    ];
    const plan = rebalance({ model, actual, rebalanceSymbols: ["DGKC"] });
    const fabl = plan.rows.find((r) => r.symbol === "FABL")!;
    const dgkc = plan.rows.find((r) => r.symbol === "DGKC")!;
    expect(fabl.action).toBe("HOLD");
    expect(fabl.deltaUnits).toBe(0);
    expect(dgkc.action).toBe("BUY");
    expect(dgkc.deltaUnits).toBeGreaterThan(0);
  });

  it("floor rounding never over-buys", () => {
    const actual: ActualHolding[] = [
      { symbol: "DGKC", quantity: 0, price: 200, value: 0 },
      { symbol: "CASH", quantity: 0, price: 1, value: 2990 },
    ];
    // investable 2990, target 100% -> 2990/200 = 14.95 -> floor 14, nearest 15
    const floorPlan = rebalance({ model: [{ symbol: "DGKC", targetPct: 100 }], actual, rounding: "floor" });
    const nearestPlan = rebalance({ model: [{ symbol: "DGKC", targetPct: 100 }], actual, rounding: "nearest" });
    expect(floorPlan.rows.find((r) => r.symbol === "DGKC")!.targetUnits).toBe(14);
    expect(nearestPlan.rows.find((r) => r.symbol === "DGKC")!.targetUnits).toBe(15);
  });
});
