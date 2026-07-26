"use client";

// Lightweight, dependency-free donut chart (SVG). Used to show the saved
// model portfolio compactly. Renders a ring of slices plus a legend.

import { pct } from "@/lib/format";

export interface Slice {
  label: string;
  value: number;
}

// Modern categorical palette (emerald-led, then teals/blues/ambers/violets).
const PALETTE = [
  "#0e9f6e", "#3b82f6", "#f59e0b", "#8b5cf6", "#14b8a6",
  "#ef4444", "#0ea5e9", "#84cc16", "#ec4899", "#6366f1",
  "#f97316", "#22c55e", "#06b6d4", "#a855f7", "#eab308",
];

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export default function PieChart({ slices, size = 150 }: { slices: Slice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + (x.value || 0), 0) || 1;
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1.25rem" }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label="Model portfolio target weights"
        style={{ flexShrink: 0 }}
      >
        <g transform="rotate(-90 50 50)">
          {slices.map((s, i) => {
            const frac = (s.value || 0) / total;
            const len = frac * C;
            const el = (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={colorFor(i)}
                strokeWidth="15"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-acc}
              />
            );
            acc += len;
            return el;
          })}
        </g>
        <text
          x="50"
          y="49"
          textAnchor="middle"
          style={{ fontSize: "9px", fontWeight: 700, fill: "var(--ink)", fontFamily: "var(--sans)" }}
        >
          {slices.length}
        </text>
        <text
          x="50"
          y="59"
          textAnchor="middle"
          style={{ fontSize: "5px", fill: "var(--ink-soft)", fontFamily: "var(--sans)", letterSpacing: "0.05em" }}
        >
          HOLDINGS
        </text>
      </svg>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: "6px 16px",
          flex: 1,
          minWidth: 200,
        }}
      >
        {slices.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: 3, background: colorFor(i), flexShrink: 0 }}
            />
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>{s.label}</span>
            <span
              style={{ marginLeft: "auto", color: "var(--ink-soft)", fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums" }}
            >
              {pct(s.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
