"use client";

import { useRef, useState } from "react";
import { ocrImage } from "@/lib/ocr";
import { parseActualCsv, parseActualText, parseHoldingsHtml } from "@/lib/parse";
import { extractActual } from "@/lib/extractClient";
import type { SymbolAlias } from "@/lib/symbols";
import type { ActualHolding } from "@/lib/types";
import type { Engine } from "@/app/page";
import { pkr, pct } from "@/lib/format";

interface Props {
  aliases: SymbolAlias[];
  engine: Engine;
  rows: ActualHolding[];
  setRows: (rows: ActualHolding[]) => void;
  portfolioId: number | null;
}

const isCashSym = (s: string) => s.trim().toUpperCase() === "CASH";
const rowValue = (r: ActualHolding) =>
  isCashSym(r.symbol) ? r.value ?? 0 : (r.quantity || 0) * (r.price || 0);

export default function ActualSection({ aliases, engine, rows, setRows, portfolioId }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [raw, setRaw] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [portfolioSize, setPortfolioSize] = useState("");
  const imgRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLInputElement>(null);

  // Fetch current prices for rows missing them. Returns merged rows + count.
  async function fillPrices(base: ActualHolding[], onlyMissing: boolean): Promise<{ rows: ActualHolding[]; filled: number; attempted: number }> {
    const targets = base.filter((r) => !isCashSym(r.symbol) && r.symbol && (!onlyMissing || !r.price));
    const symbols = Array.from(new Set(targets.map((r) => r.symbol.toUpperCase())));
    if (symbols.length === 0) return { rows: base, filled: 0, attempted: 0 };
    const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbols.join(","))}`);
    const d = await res.json().catch(() => ({ prices: {} }));
    const prices: Record<string, number> = d.prices ?? {};
    let filled = 0;
    const merged = base.map((r) => {
      if (isCashSym(r.symbol)) return r;
      if (onlyMissing && r.price) return r;
      const p = prices[r.symbol.toUpperCase()];
      if (typeof p === "number" && p > 0) {
        filled++;
        return { ...r, price: p };
      }
      return r;
    });
    return { rows: merged, filled, attempted: symbols.length };
  }

  // After an import, auto-fetch only the prices that are missing.
  async function autoFillMissing(parsed: ActualHolding[], sourceMsg: string) {
    const missing = parsed.filter((r) => !isCashSym(r.symbol) && !r.price).length;
    if (missing === 0) {
      setStatus(sourceMsg);
      return;
    }
    setStatus(`${sourceMsg} Fetching ${missing} missing price(s) from PSX…`);
    try {
      const { rows: merged, filled, attempted } = await fillPrices(parsed, true);
      setRows(merged);
      setStatus(
        `${sourceMsg} ${filled > 0 ? `Filled ${filled}/${attempted} prices from PSX.` : "PSX returned no prices — enter the missing ones manually."}`
      );
    } catch {
      setStatus(`${sourceMsg} Couldn't reach PSX — enter missing prices manually.`);
    }
  }

  async function handleHtml(file: File) {
    setBusy(true);
    setStatus("Reading saved page…");
    try {
      const parsed = parseHoldingsHtml(await file.text(), aliases);
      setRows(parsed);
      if (parsed.length === 0) {
        setStatus("Couldn't find a holdings table in that file. Is it the saved zar.sarmaaya page?");
      } else {
        await autoFillMissing(parsed, `Imported ${parsed.length} holdings from the saved page (exact values).`);
      }
    } catch (e) {
      setStatus(`HTML import failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCsv(file: File) {
    setBusy(true);
    try {
      const parsed = parseActualCsv(await file.text(), aliases);
      setRows(parsed);
      await autoFillMissing(parsed, `Imported ${parsed.length} rows from CSV.`);
    } catch (e) {
      setStatus(`CSV import failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleImage(file: File) {
    setBusy(true);
    try {
      if (engine === "vision") {
        setStatus("Extracting with AI Vision…");
        const holdings = await extractActual(file);
        setRows(holdings);
        if (holdings.length) await autoFillMissing(holdings, `AI Vision extracted ${holdings.length} rows.`);
        else setStatus("AI Vision returned no rows — use HTML import, CSV, or manual entry.");
        return;
      }
      setStatus("Reading image…");
      const text = await ocrImage(file, {
        kind: "table",
        onProgress: (p) => setStatus(`${p.status} ${Math.round(p.progress * 100)}%`),
      });
      setRaw(text);
      const parsed = parseActualText(text, aliases);
      setRows(parsed);
      if (parsed.length) await autoFillMissing(parsed, `Detected ${parsed.length} rows (verify — OCR is imperfect).`);
      else {
        setStatus("No rows detected — edit the raw text below and re-parse, or use HTML / CSV / manual entry.");
        setShowRaw(true);
      }
    } catch (e) {
      setStatus(`${engine === "vision" ? "Vision" : "OCR"} failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  function reparse() {
    const parsed = parseActualText(raw, aliases);
    setRows(parsed);
    setStatus(`Re-parsed ${parsed.length} rows from the edited text.`);
  }

  async function fetchPricesClick() {
    setBusy(true);
    setStatus("Fetching current prices from PSX…");
    try {
      const { rows: merged, filled, attempted } = await fillPrices(rows, false);
      setRows(merged);
      setStatus(
        filled > 0
          ? `Filled ${filled}/${attempted} prices from PSX.`
          : "PSX returned no prices (the source may be blocked). Enter current prices manually."
      );
    } catch (e) {
      setStatus(`Price fetch failed: ${String(e instanceof Error ? e.message : e)}. Enter prices manually.`);
    } finally {
      setBusy(false);
    }
  }

  async function saveHoldings() {
    setBusy(true);
    try {
      const res = await fetch("/api/holdings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolioId, holdings: rows }),
      });
      const d = await res.json();
      setStatus(d.error ? `Save failed: ${d.error}` : `Saved ${rows.length} holdings to this portfolio.`);
    } catch (e) {
      setStatus(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadSaved() {
    setBusy(true);
    try {
      const url = portfolioId != null ? `/api/holdings?portfolioId=${portfolioId}` : "/api/holdings";
      const d = await (await fetch(url)).json();
      setRows(d.holdings ?? []);
      setStatus(`Loaded ${(d.holdings ?? []).length} saved holdings.`);
    } catch (e) {
      setStatus(`Load failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  const stockValue = rows.filter((r) => !isCashSym(r.symbol)).reduce((s, r) => s + rowValue(r), 0);
  const cashValue = rows.filter((r) => isCashSym(r.symbol)).reduce((s, r) => s + rowValue(r), 0);
  const totalValue = stockValue + cashValue;

  function fillCashFromSize() {
    const size = Number(portfolioSize);
    if (!size || size <= 0) {
      setStatus("Enter a total portfolio size first.");
      return;
    }
    const cash = Math.round((size - stockValue) * 100) / 100;
    const others = rows.filter((r) => !isCashSym(r.symbol));
    setRows([...others, { symbol: "CASH", name: "Cash", quantity: 0, price: 1, value: Math.max(0, cash) }]);
    setStatus(
      cash < 0
        ? `Holdings (${pkr(stockValue)}) already exceed the portfolio size — cash set to 0. Check prices/size.`
        : `Cash set to ${pkr(cash)} (size ${pkr(size)} − holdings ${pkr(stockValue)}).`
    );
  }

  function update(i: number, patch: Partial<ActualHolding>) {
    setRows(rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  const remove = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const addRow = () => setRows([...rows, { symbol: "", quantity: 0, price: 0 }]);
  const addCash = () => {
    if (rows.some((r) => isCashSym(r.symbol))) return;
    setRows([...rows, { symbol: "CASH", name: "Cash", quantity: 0, price: 1, value: 0 }]);
  };

  return (
    <section className="card">
      <div className="mb-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="folio">02</span>
          <span className="eyebrow">Actual</span>
        </div>
        <h2 className="section-title" style={{ fontSize: "19px" }}>
          Current Holdings
        </h2>
        <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: 2 }}>
          Read fresh every run. Importing the saved zar.sarmaaya page is the most accurate.
        </p>
      </div>

      {/* Import sources vs manual entry — visually separated groups */}
      <div className="toolbar mb-3">
        <div className="toolbar-group">
          <span className="toolbar-label">Import</span>
          <button className="btn-primary" disabled={busy} onClick={() => htmlRef.current?.click()}>
            Saved page (HTML)
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => csvRef.current?.click()}>
            CSV
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => imgRef.current?.click()}>
            Screenshot ({engine === "vision" ? "Vision" : "OCR"})
          </button>
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="toolbar-group">
          <span className="toolbar-label">Manual</span>
          <button className="btn-ghost" disabled={busy} onClick={addRow}>
            + Add row
          </button>
          <button className="btn-ghost" disabled={busy} onClick={addCash}>
            + Add cash
          </button>
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <div className="toolbar-group">
          <span className="toolbar-label">Saved</span>
          <button className="btn-ghost" disabled={busy || rows.length === 0} onClick={saveHoldings}>
            Save holdings
          </button>
          <button className="btn-ghost" disabled={busy} onClick={loadSaved}>
            Load saved
          </button>
        </div>
        <input ref={htmlRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => e.target.files?.[0] && handleHtml(e.target.files[0])} />
        <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])} />
        <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])} />
      </div>

      {/* Value-from-units panel (CSV / manual workflow) */}
      <div className="subpanel mb-3">
        <span className="toolbar-label">Value from units</span>
        <button className="btn-ghost" disabled={busy || rows.length === 0} onClick={fetchPricesClick}>
          Fetch PSX prices
        </button>
        <label className="field">
          <span>Total portfolio size (PKR)</span>
          <input type="number" className="input" style={{ maxWidth: 170 }} value={portfolioSize} placeholder="e.g. 10710800" onChange={(e) => setPortfolioSize(e.target.value)} />
        </label>
        <button className="btn-ghost" disabled={busy || rows.length === 0} onClick={fillCashFromSize}>
          Set cash = size − holdings
        </button>
      </div>

      {status && <p className="mb-2 text-xs text-slate-500">{status}</p>}

      {raw && (
        <div className="mb-3">
          <button className="link" onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? "Hide" : "Show"} raw OCR text (edit & re-parse)
          </button>
          {showRaw && (
            <div className="mt-2">
              <textarea className="input h-32" value={raw} onChange={(e) => setRaw(e.target.value)} />
              <button className="btn-ghost mt-2" onClick={reparse}>
                Re-parse from text
              </button>
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="ledger-wrap">
          <table>
            <thead>
              <tr>
                <th className="th">Symbol</th>
                <th className="th">Quantity</th>
                <th className="th">Curr. Price</th>
                <th className="th">Market value</th>
                <th className="th">%</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const cash = isCashSym(r.symbol);
                const mv = rowValue(r);
                const share = totalValue > 0 ? (mv / totalValue) * 100 : 0;
                return (
                  <tr key={i}>
                    <td className="td">
                      <input className="input uppercase" style={{ maxWidth: 110 }} value={r.symbol} onChange={(e) => update(i, { symbol: e.target.value.toUpperCase() })} />
                    </td>
                    <td className="td">
                      {cash ? (
                        <span style={{ color: "var(--ink-faint)" }}>—</span>
                      ) : (
                        <input type="number" className="input" style={{ maxWidth: 110 }} value={r.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} />
                      )}
                    </td>
                    <td className="td">
                      {cash ? (
                        <span style={{ color: "var(--ink-faint)" }}>—</span>
                      ) : (
                        <input type="number" className="input" style={{ maxWidth: 110 }} value={r.price} onChange={(e) => update(i, { price: Number(e.target.value) })} />
                      )}
                    </td>
                    <td className="td">
                      {cash ? (
                        <input type="number" className="input" style={{ maxWidth: 150 }} value={r.value ?? 0} onChange={(e) => update(i, { value: Number(e.target.value) })} />
                      ) : (
                        <span style={{ fontWeight: 500 }}>{pkr(mv)}</span>
                      )}
                    </td>
                    <td className="td" style={{ color: "var(--ink-soft)" }}>{pct(share)}</td>
                    <td className="td">
                      <button className="text-xs text-rose-600 hover:underline" onClick={() => remove(i)}>
                        remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td>{pkr(totalValue)}</td>
                <td>{pct(totalValue > 0 ? 100 : 0)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
