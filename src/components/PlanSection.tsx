"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActualHolding, ModelHolding, RebalancePlan } from "@/lib/types";
import { num, pct, pkr } from "@/lib/format";

interface Props {
  actual: ActualHolding[];
  model: ModelHolding[];
  modelSaved: boolean;
  portfolioId: number | null;
}

export default function PlanSection({ actual, model, modelSaved, portfolioId }: Props) {
  const [extraCash, setExtraCash] = useState(0);
  const [rounding, setRounding] = useState<"nearest" | "floor">("nearest");
  const [useLivePrices, setUseLivePrices] = useState(false);
  const [scope, setScope] = useState<"full" | "selected">("full");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [plan, setPlan] = useState<RebalancePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tradable = actual.map((r) => r.symbol.toUpperCase()).filter((s) => s && s !== "CASH");
  const toggle = (sym: string) => setSelected((s) => ({ ...s, [sym]: !s[sym] }));
  const chosen = tradable.filter((s) => selected[s]);
  const skipAutoRegen = useRef(true);

  const generate = useCallback(async (options?: { save?: boolean }) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.length > 0 ? model : undefined,
          actual,
          extraCash,
          rounding,
          useLivePrices,
          portfolioId,
          rebalanceSymbols: scope === "selected" ? chosen : [],
          save: options?.save ?? true,
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setPlan(d.plan);
      skipAutoRegen.current = true;
    } catch (e) {
      setError(String(e));
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }, [actual, model, extraCash, rounding, useLivePrices, portfolioId, scope, chosen]);

  useEffect(() => {
    setPlan(null);
    setError("");
    skipAutoRegen.current = true;
  }, [portfolioId]);

  useEffect(() => {
    if (!plan) {
      skipAutoRegen.current = true;
      return;
    }
    if (skipAutoRegen.current) {
      skipAutoRegen.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void generate({ save: false });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [actual, model, extraCash, rounding, useLivePrices, scope, selected, portfolioId, plan, generate]);

  function exportCsv() {
    if (!plan) return;
    const header = ["Symbol", "Action", "Current Units", "Target Units", "Delta Units", "Price", "Current %", "Target %", "Cash Impact (PKR)"];
    const lines = plan.rows.map((r) =>
      [r.symbol, r.action, r.currentUnits, r.targetUnits, r.deltaUnits, r.price, r.currentPct.toFixed(2), r.targetPct.toFixed(2), Math.round(r.cashImpact)].join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rebalance-plan.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const canGenerate =
    modelSaved && actual.length > 0 && !busy && (scope === "full" || chosen.length > 0);

  return (
    <section className="card">
      <div className="mb-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="folio">03</span>
          <span className="eyebrow">Orders</span>
        </div>
        <h2 className="section-title" style={{ fontSize: "19px" }}>
          Rebalancing Plan
        </h2>
        <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: 2 }}>
          Whole-share buys and sells to bring you onto the model.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="field">
          <span>New cash to invest (optional)</span>
          <input type="number" className="input" style={{ maxWidth: 170 }} value={extraCash} onChange={(e) => setExtraCash(Number(e.target.value) || 0)} />
        </label>
        <label className="field">
          <span>Rounding</span>
          <select className="input" value={rounding} onChange={(e) => setRounding(e.target.value as "nearest" | "floor")}>
            <option value="nearest">Nearest whole share</option>
            <option value="floor">Never over-buy (floor)</option>
          </select>
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8 }}>
          <input type="checkbox" checked={useLivePrices} onChange={(e) => setUseLivePrices(e.target.checked)} />
          <span>Fill missing prices from live PSX</span>
        </label>
        <label className="field">
          <span>Rebalance</span>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as "full" | "selected")}>
            <option value="full">Whole portfolio</option>
            <option value="selected">Selected shares only</option>
          </select>
        </label>
        <button className="btn-primary" disabled={!canGenerate} onClick={() => void generate()}>
          {busy ? "Generating…" : "Generate plan"}
        </button>
      </div>

      {scope === "selected" && (
        <div className="subpanel mb-4" style={{ alignItems: "center" }}>
          <span className="toolbar-label">Trade only</span>
          {tradable.length === 0 && <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Load holdings first.</span>}
          {tradable.map((s) => (
            <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={!!selected[s]} onChange={() => toggle(s)} />
              {s}
            </label>
          ))}
        </div>
      )}

      {!modelSaved && (
        <p style={{ fontSize: "12px", color: "var(--brass)" }}>Post a model portfolio first (folio 01).</p>
      )}
      {error && <p style={{ fontSize: "12px", color: "var(--red)" }}>{error}</p>}

      {plan && (
        <div className="rise">
          {plan.warnings.length > 0 && (
            <div className="notice mb-4">
              {plan.warnings.map((w, i) => (
                <div key={i} style={{ marginTop: i ? 4 : 0 }}>— {w}</div>
              ))}
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Investable total" value={pkr(plan.totals.investableTotal)} />
            <Stat label="Buy cash needed" value={pkr(Math.abs(plan.totals.buyCash))} />
            <Stat label="Sell proceeds" value={pkr(plan.totals.sellProceeds)} />
            <Stat label="Cash after trades" value={pkr(plan.totals.netCashAfter)} accent={plan.totals.netCashAfter < 0} />
          </div>

          <div className="ledger-wrap">
            <table>
              <thead>
                <tr>
                  <th className="th">Symbol</th>
                  <th className="th">Action</th>
                  <th className="th">Units to trade</th>
                  <th className="th">Current → Target units</th>
                  <th className="th">Price</th>
                  <th className="th">Current % → Target %</th>
                  <th className="th">Cash impact</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.symbol} style={r.action === "HOLD" ? { opacity: 0.65 } : undefined}>
                    <td style={{ fontWeight: 500 }}>{r.symbol}</td>
                    <td>
                      <span className={r.action === "BUY" ? "badge-buy" : r.action === "SELL" ? "badge-sell" : "badge-hold"}>{r.action}</span>
                    </td>
                    <td
                      style={{
                        fontWeight: 600,
                        color: r.action === "BUY" ? "var(--green)" : r.action === "SELL" ? "var(--red)" : "var(--ink)",
                      }}
                    >
                      {r.priceMissing ? "—" : r.symbol === "CASH" ? "—" : `${r.deltaUnits > 0 ? "+" : ""}${num(r.deltaUnits)}`}
                    </td>
                    <td style={{ color: "var(--ink-soft)" }}>
                      {num(r.currentUnits)} → {num(r.targetUnits)}
                    </td>
                    <td>{r.priceMissing ? <span style={{ color: "var(--red)" }}>missing</span> : num(r.price)}</td>
                    <td style={{ color: "var(--ink-soft)" }}>
                      {pct(r.currentPct)} → {pct(r.targetPct)}
                    </td>
                    <td style={{ color: r.cashImpact < 0 ? "var(--red)" : r.cashImpact > 0 ? "var(--green)" : "var(--ink)" }}>
                      {r.cashImpact === 0 ? "—" : pkr(r.cashImpact)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3">
            <button className="btn-ghost" onClick={exportCsv}>
              Export plan as CSV
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${accent ? "neg" : ""}`}>{value}</div>
    </div>
  );
}
