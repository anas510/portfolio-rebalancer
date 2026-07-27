import type { ActualHolding } from "./types";

const CASH = "CASH";

export function isCashSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase() === CASH;
}

/** Market value of a holding. Stocks use quantity × price; CASH uses its explicit value. */
export function holdingMarketValue(h: ActualHolding): number {
  if (isCashSymbol(h.symbol)) return h.value ?? h.quantity ?? 0;
  return (h.quantity || 0) * (h.price || 0);
}

export function computePortfolioTotals(rows: ActualHolding[]): {
  stockValue: number;
  cashValue: number;
  totalValue: number;
} {
  const stockValue = rows
    .filter((r) => !isCashSymbol(r.symbol))
    .reduce((s, r) => s + holdingMarketValue(r), 0);
  const cashValue = rows
    .filter((r) => isCashSymbol(r.symbol))
    .reduce((s, r) => s + holdingMarketValue(r), 0);
  return { stockValue, cashValue, totalValue: stockValue + cashValue };
}

/** When a target portfolio size is set, derive cash as size − stock holdings. */
export function resolvePortfolioSize(targetSize: number | null | undefined, rows: ActualHolding[]): string {
  if (targetSize != null && targetSize > 0) return String(Math.round(targetSize * 100) / 100);
  const { totalValue } = computePortfolioTotals(rows);
  if (totalValue <= 0) return "";
  return String(Math.round(totalValue * 100) / 100);
}

export function syncCashToPortfolioSize(rows: ActualHolding[], size: number): ActualHolding[] {
  if (!Number.isFinite(size) || size <= 0) return rows;

  const { stockValue } = computePortfolioTotals(rows);
  const cash = Math.max(0, Math.round((size - stockValue) * 100) / 100);
  const others = rows.filter((r) => !isCashSymbol(r.symbol));
  return [...others, { symbol: CASH, name: "Cash", quantity: 0, price: 1, value: cash }];
}
