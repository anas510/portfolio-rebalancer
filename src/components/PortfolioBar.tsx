"use client";

import { useState } from "react";
import type { PortfolioSummary } from "@/lib/types";

interface Props {
  portfolios: PortfolioSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onChanged: () => void; // reload list after create/rename/delete
}

export default function PortfolioBar({ portfolios, selectedId, onSelect, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const current = portfolios.find((p) => p.id === selectedId);

  async function act(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="eyebrow">Portfolio</span>
        <select
          className="input"
          style={{ minWidth: 220 }}
          value={selectedId ?? ""}
          disabled={busy}
          onChange={(e) => onSelect(Number(e.target.value))}
        >
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.hasCustomModel ? " · custom model" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={() => {
            const name = window.prompt("New portfolio name?", "New Portfolio");
            if (name) act("create", { name });
          }}
        >
          + New
        </button>
        <button
          className="btn-ghost"
          disabled={busy || !current}
          onClick={() => {
            const name = window.prompt("Rename portfolio", current?.name ?? "");
            if (name && current) act("rename", { id: current.id, name });
          }}
        >
          Rename
        </button>
        <button
          className="btn-ghost"
          disabled={busy || !current || portfolios.length <= 1}
          title={portfolios.length <= 1 ? "Keep at least one portfolio" : ""}
          onClick={() => {
            if (current && window.confirm(`Delete “${current.name}” and its saved holdings?`)) {
              act("delete", { id: current.id });
            }
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
