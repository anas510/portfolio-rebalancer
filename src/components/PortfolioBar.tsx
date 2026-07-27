"use client";

import LoadingIndicator from "@/components/LoadingIndicator";
import type { PortfolioSummary } from "@/lib/types";

interface Props {
  portfolios: PortfolioSummary[];
  selectedId: number | null;
  busy?: boolean;
  busyLabel?: string;
  onSelect: (id: number) => void | Promise<void>;
  onCreate: (name: string) => void | Promise<void>;
  onRename: (id: number, name: string) => void | Promise<void>;
  onDelete: (id: number) => void | Promise<void>;
}

export default function PortfolioBar({
  portfolios,
  selectedId,
  busy = false,
  busyLabel,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const current = portfolios.find((p) => p.id === selectedId);

  async function handleSelect(id: number) {
    if (busy || id === selectedId) return;
    await onSelect(id);
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">Portfolio</span>
        <select
          className="input"
          style={{ minWidth: 220 }}
          value={selectedId ?? ""}
          disabled={busy}
          aria-busy={busy}
          onChange={(e) => void handleSelect(Number(e.target.value))}
        >
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.hasCustomModel ? " · custom model" : ""}
            </option>
          ))}
        </select>
        {busy && busyLabel && <LoadingIndicator label={busyLabel} size="sm" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={() => {
            const name = window.prompt("New portfolio name?", "New Portfolio");
            if (name) void onCreate(name);
          }}
        >
          + New
        </button>
        <button
          className="btn-ghost"
          disabled={busy || !current}
          onClick={() => {
            const name = window.prompt("Rename portfolio", current?.name ?? "");
            if (name && current) void onRename(current.id, name);
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
              void onDelete(current.id);
            }
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
