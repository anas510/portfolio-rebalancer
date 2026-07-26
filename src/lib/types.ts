// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

/** A single target position in the (saved) model portfolio. */
export interface ModelHolding {
  /** Canonical PSX ticker, e.g. "FABL". "CASH" is a valid symbol. */
  symbol: string;
  /** Human-friendly name as it appeared on the source image (optional). */
  name?: string;
  /** Target weight in percent (0..100). */
  targetPct: number;
}

/** The saved model portfolio. Weights should sum to ~100. */
export interface ModelPortfolio {
  id: number;
  name: string;
  holdings: ModelHolding[];
  updatedAt: string;
}

/** A single position in the CURRENT (actual) portfolio. Read fresh every time. */
export interface ActualHolding {
  /** Canonical PSX ticker, e.g. "FABL". "CASH" is a valid symbol. */
  symbol: string;
  name?: string;
  /** Units/shares currently held. For CASH this is 0 (value carried in `value`). */
  quantity: number;
  /** Current price per share in PKR. For CASH this is 1. */
  price: number;
  /**
   * Market value in PKR. If provided it is trusted directly; otherwise it is
   * computed as quantity * price. For CASH this is the cash amount.
   */
  value?: number;
}

/** One row of the rebalancing plan. */
export interface PlanRow {
  symbol: string;
  name?: string;
  price: number;
  currentUnits: number;
  currentValue: number;
  currentPct: number;
  targetPct: number;
  targetValue: number;
  targetUnits: number;
  /** targetUnits - currentUnits (positive = buy, negative = sell). */
  deltaUnits: number;
  action: "BUY" | "SELL" | "HOLD";
  /** Estimated cash needed (BUY, negative) or freed (SELL, positive), PKR. */
  cashImpact: number;
  /** True when we had no reliable price and could not size the trade. */
  priceMissing?: boolean;
}

export interface RebalancePlan {
  rows: PlanRow[];
  totals: {
    currentValue: number;
    cashAvailable: number;
    investableTotal: number;
    /** Sum of buy cash needed (negative number). */
    buyCash: number;
    /** Sum of sell proceeds (positive number). */
    sellProceeds: number;
    /** Net cash after executing all trades (investableTotal not exceeded). */
    netCashAfter: number;
    /** Residual cash target (from model CASH weight). */
    targetCash: number;
  };
  warnings: string[];
}

export type PriceSource = "image" | "manual" | "psx-live";

/** A named portfolio (its own holdings; shared model unless overridden). */
export interface PortfolioSummary {
  id: number;
  name: string;
  /** True when this portfolio uses its own model instead of the shared default. */
  hasCustomModel: boolean;
  updatedAt: string;
}
