// Small formatting helpers (client & server safe).

export function pkr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Math.round(n));
}

export function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function num(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-PK").format(n);
}
