"use client";

import { useEffect, useRef, useState } from "react";
import { ocrImage } from "@/lib/ocr";
import { parseModelText } from "@/lib/parse";
import { extractModel } from "@/lib/extractClient";
import type { SymbolAlias } from "@/lib/symbols";
import type { ModelHolding } from "@/lib/types";
import { pct } from "@/lib/format";
import type { Engine } from "@/app/page";
import PieChart from "@/components/PieChart";

interface Props {
  aliases: SymbolAlias[];
  engine: Engine;
  portfolioId: number | null;
  onSaved: (model: { holdings: ModelHolding[]; name: string; updatedAt: string }) => void;
}

export default function ModelSection({ aliases, engine, portfolioId, onSaved }: Props) {
  const [rows, setRows] = useState<ModelHolding[]>([]);
  const [name, setName] = useState("Model Portfolio");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  // Collapsed (chart-only) once a model is saved; expands to the editor on Edit.
  const [editing, setEditing] = useState(true);
  // Where a save goes: the shared default model, or a custom one for this portfolio.
  const [scope, setScope] = useState<"default" | "custom">("default");
  const fileRef = useRef<HTMLInputElement>(null);

  const modelUrl = portfolioId != null ? `/api/model?portfolioId=${portfolioId}` : "/api/model";

  // Load the effective model whenever the selected portfolio changes.
  useEffect(() => {
    if (portfolioId == null) return;
    fetch(modelUrl)
      .then((r) => r.json())
      .then((d) => {
        if (d.model) {
          setRows(d.model.holdings);
          setName(d.model.name);
          setSavedAt(d.model.updatedAt);
          setEditing(false);
        } else {
          setRows([]);
          setSavedAt(null);
          setEditing(true);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  async function reloadSaved() {
    try {
      const d = await (await fetch(modelUrl)).json();
      if (d.model) {
        setRows(d.model.holdings);
        setName(d.model.name);
        setSavedAt(d.model.updatedAt);
      }
    } catch {
      /* ignore */
    }
    setStatus("");
    setEditing(false);
  }

  async function handleImage(file: File) {
    setBusy(true);
    try {
      if (engine === "vision") {
        setStatus("Extracting with AI Vision…");
        const holdings = await extractModel(file);
        setRows(holdings);
        setStatus(
          holdings.length
            ? `AI Vision extracted ${holdings.length} target weights — review & edit below.`
            : "AI Vision returned no rows — add rows manually."
        );
        return;
      }
      setStatus("Reading image…");
      const text = await ocrImage(file, {
        kind: "list",
        onProgress: (p) => setStatus(`${p.status} ${Math.round(p.progress * 100)}%`),
      });
      setRaw(text);
      const parsed = parseModelText(text, aliases);
      if (parsed.length === 0) {
        setStatus("No weights detected — edit the raw text below and re-parse, or add rows manually.");
        setShowRaw(true);
      } else {
        setStatus(`Detected ${parsed.length} target weights — review & edit below. Symbols auto-corrected to known PSX tickers.`);
      }
      setRows(parsed);
    } catch (e) {
      setStatus(`${engine === "vision" ? "Vision" : "OCR"} failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  function reparse() {
    const parsed = parseModelText(raw, aliases);
    setRows(parsed);
    setStatus(`Re-parsed ${parsed.length} rows from the edited text.`);
  }

  function update(i: number, patch: Partial<ModelHolding>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function remove(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }
  function addRow() {
    setRows((r) => [...r, { symbol: "", name: "", targetPct: 0 }]);
  }

  const total = rows.reduce((s, r) => s + (Number(r.targetPct) || 0), 0);

  async function save() {
    setBusy(true);
    setStatus("Saving…");
    try {
      const res = await fetch("/api/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, holdings: rows, scope, portfolioId }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setSavedAt(d.model.updatedAt);
      setRows(d.model.holdings);
      setStatus("");
      setEditing(false);
      onSaved(d.model);
    } catch (e) {
      setStatus(`Save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const chartSlices = rows
    .filter((r) => (Number(r.targetPct) || 0) > 0)
    .map((r) => ({ label: r.symbol || r.name || "—", value: Number(r.targetPct) || 0 }));

  // ---- Collapsed view: chart + Edit (shown once a model is saved) ----------
  if (!editing) {
    return (
      <section className="card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="folio">01</span>
              <span className="eyebrow">Target</span>
            </div>
            <h2 className="section-title" style={{ fontSize: "19px" }}>
              {name}
            </h2>
            <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: 2 }}>
              Saved{savedAt ? ` · ${new Date(savedAt + "Z").toLocaleDateString()}` : ""} · reused every run.
            </p>
          </div>
          <button className="btn-ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        {chartSlices.length > 0 ? (
          <PieChart slices={chartSlices} />
        ) : (
          <p style={{ fontSize: "13px", color: "var(--ink-soft)" }}>No weights saved yet.</p>
        )}
      </section>
    );
  }

  // ---- Editing view --------------------------------------------------------
  return (
    <section className="card">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="folio">01</span>
            <span className="eyebrow">Target</span>
          </div>
          <h2 className="section-title" style={{ fontSize: "19px" }}>
            Model Portfolio
          </h2>
          <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: 2 }}>
            Posted to the ledger and reused every run.{" "}
            {savedAt ? `Last saved ${new Date(savedAt + "Z").toLocaleString()}.` : "Not saved yet."}
          </p>
        </div>
        <input
          className="input max-w-[180px]"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Model name"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          Upload model image ({engine === "vision" ? "Vision" : "OCR"})
        </button>
        <button className="btn-ghost" disabled={busy} onClick={addRow}>
          + Add row
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])}
        />
      </div>

      {status && <p className="mb-2 text-xs text-slate-500">{status}</p>}

      {raw && (
        <div className="mb-3">
          <button className="link" onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? "Hide" : "Show"} raw OCR text (edit & re-parse)
          </button>
          {showRaw && (
            <div className="mt-2">
              <textarea
                className="input h-32 font-mono text-xs"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
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
                <th className="th">Company (from image)</th>
                <th className="th">Target %</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="td">
                    <input
                      className="input max-w-[110px] uppercase"
                      value={r.symbol}
                      onChange={(e) => update(i, { symbol: e.target.value.toUpperCase() })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className="input"
                      value={r.name ?? ""}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <input
                      type="number"
                      className="input max-w-[90px]"
                      value={r.targetPct}
                      onChange={(e) => update(i, { targetPct: Number(e.target.value) })}
                    />
                  </td>
                  <td className="td">
                    <button className="text-xs text-rose-600 hover:underline" onClick={() => remove(i)}>
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td style={{ color: Math.abs(total - 100) > 0.5 ? "var(--red)" : "var(--green)" }}>
                  {pct(total)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="field">
          <span>Apply model to</span>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as "default" | "custom")}>
            <option value="default">All portfolios (shared default)</option>
            <option value="custom">Only this portfolio</option>
          </select>
        </label>
        <button className="btn-primary" disabled={busy || rows.length === 0} onClick={save}>
          Save model portfolio
        </button>
        {savedAt && (
          <button className="btn-ghost" disabled={busy} onClick={reloadSaved}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
