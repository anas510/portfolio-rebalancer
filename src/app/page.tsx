"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ModelSection from "@/components/ModelSection";
import ActualSection from "@/components/ActualSection";
import PlanSection from "@/components/PlanSection";
import PortfolioBar from "@/components/PortfolioBar";
import LoadingIndicator from "@/components/LoadingIndicator";
import { resolvePortfolioSize, syncCashToPortfolioSize } from "@/lib/portfolioValue";
import type { SymbolAlias } from "@/lib/symbols";
import type { ActualHolding, ModelHolding, PortfolioSummary } from "@/lib/types";

export type Engine = "ocr" | "vision";

async function postPortfolioAction(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/portfolios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as { portfolios?: PortfolioSummary[]; selectedId?: number | null };
}

export default function Home() {
  const [aliases, setAliases] = useState<SymbolAlias[]>([]);
  const [engine, setEngine] = useState<Engine>("ocr");
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [visionProvider, setVisionProvider] = useState<string | null>(null);

  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [actual, setActual] = useState<ActualHolding[]>([]);
  const [model, setModel] = useState<ModelHolding[]>([]);
  const [modelSaved, setModelSaved] = useState(false);
  const [portfolioSize, setPortfolioSize] = useState("");
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const [portfolioBusyLabel, setPortfolioBusyLabel] = useState("Loading…");
  const portfolioSizesRef = useRef<Record<number, string>>({});
  const portfolioSizeRef = useRef("");
  portfolioSizeRef.current = portfolioSize;
  const prevSelectedRef = useRef<number | null>(null);
  const skipPortfolioLoadEffect = useRef(false);

  const setPortfolioSizeForCurrent = useCallback(
    (value: string) => {
      setPortfolioSize(value);
      if (selectedId != null) {
        portfolioSizesRef.current[selectedId] = value;
      }
    },
    [selectedId]
  );

  useEffect(() => {
    const prev = prevSelectedRef.current;
    if (prev != null && selectedId != null && prev !== selectedId) {
      portfolioSizesRef.current[prev] = portfolioSizeRef.current;
    }
    if (selectedId != null) {
      prevSelectedRef.current = selectedId;
    }
  }, [selectedId]);

  const runPortfolioTask = useCallback(async (label: string, task: () => Promise<void>) => {
    setPortfolioBusy(true);
    setPortfolioBusyLabel(label);
    try {
      await task();
    } finally {
      setPortfolioBusy(false);
    }
  }, []);

  const refreshPortfolios = useCallback(async () => {
    const d = await fetch("/api/portfolios").then((r) => r.json());
    setPortfolios(d.portfolios ?? []);
    const nextId = d.selectedId ?? null;
    setSelectedId(nextId);
    return nextId as number | null;
  }, []);

  const loadPortfolioData = useCallback(async (id: number) => {
    const [m, h] = await Promise.all([
      fetch(`/api/model?portfolioId=${id}`).then((r) => r.json()),
      fetch(`/api/holdings?portfolioId=${id}`).then((r) => r.json()),
    ]);
    setModelSaved(Boolean(m.model));
    setModel(m.model?.holdings ?? []);

    const holdings: ActualHolding[] = h.holdings ?? [];
    const sessionSize = portfolioSizesRef.current[id];
    const sizeStr =
      sessionSize !== undefined ? sessionSize : resolvePortfolioSize(h.targetSize, holdings);
    setPortfolioSize(sizeStr);

    const size = Number(sizeStr);
    setActual(size > 0 ? syncCashToPortfolioSize(holdings, size) : holdings);
  }, []);

  const applyPortfolioList = useCallback((data: { portfolios?: PortfolioSummary[]; selectedId?: number | null }) => {
    setPortfolios(data.portfolios ?? []);
    setSelectedId(data.selectedId ?? null);
    return data.selectedId ?? null;
  }, []);

  useEffect(() => {
    fetch("/api/symbols").then((r) => r.json()).then((d) => setAliases(d.aliases ?? [])).catch(() => {});
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        setVisionAvailable(Boolean(d.visionAvailable));
        setVisionProvider(d.visionProvider ?? null);
        if (d.visionAvailable) setEngine("vision");
      })
      .catch(() => {});
    void runPortfolioTask("Loading portfolios…", async () => {
      await refreshPortfolios();
    });
  }, [refreshPortfolios, runPortfolioTask]);

  useEffect(() => {
    if (selectedId == null) return;
    if (skipPortfolioLoadEffect.current) {
      skipPortfolioLoadEffect.current = false;
      return;
    }
    void runPortfolioTask("Loading portfolio…", () => loadPortfolioData(selectedId));
  }, [selectedId, loadPortfolioData, runPortfolioTask]);

  async function handleSelect(id: number) {
    if (id === selectedId) return;
    await runPortfolioTask("Switching portfolio…", async () => {
      await postPortfolioAction("select", { id });
      skipPortfolioLoadEffect.current = true;
      setSelectedId(id);
      await loadPortfolioData(id);
    });
  }

  async function handleCreate(name: string) {
    await runPortfolioTask("Creating portfolio…", async () => {
      const data = await postPortfolioAction("create", { name });
      const nextId = applyPortfolioList(data);
      skipPortfolioLoadEffect.current = true;
      if (nextId != null) await loadPortfolioData(nextId);
    });
  }

  async function handleRename(id: number, name: string) {
    await runPortfolioTask("Renaming portfolio…", async () => {
      const data = await postPortfolioAction("rename", { id, name });
      applyPortfolioList(data);
    });
  }

  async function handleDelete(id: number) {
    await runPortfolioTask("Deleting portfolio…", async () => {
      const data = await postPortfolioAction("delete", { id });
      const nextId = applyPortfolioList(data);
      skipPortfolioLoadEffect.current = true;
      if (nextId != null) await loadPortfolioData(nextId);
      else {
        setActual([]);
        setModel([]);
        setModelSaved(false);
        setPortfolioSize("");
      }
    });
  }

  const providerLabel = visionProvider === "gemini" ? "Gemini" : visionProvider === "claude" ? "Claude" : "AI";

  return (
    <div className="space-y-6">
      <p style={{ maxWidth: "46rem", fontSize: "15px", lineHeight: 1.6, color: "var(--ink-soft)" }}>
        Manage one or more portfolios. Set a <span style={{ color: "var(--ink)", fontWeight: 500 }}>model</span>{" "}
        (shared or per-portfolio), load <span style={{ color: "var(--ink)", fontWeight: 500 }}>current holdings</span>,
        and get the exact shares to buy and sell to bring them into balance.
      </p>

      <PortfolioBar
        portfolios={portfolios}
        selectedId={selectedId}
        busy={portfolioBusy}
        busyLabel={portfolioBusyLabel}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      {portfolioBusy && (
        <div className="loading-banner" role="status" aria-live="polite">
          <LoadingIndicator label={portfolioBusyLabel} size="sm" />
        </div>
      )}

      <div className={portfolioBusy ? "content-loading space-y-6" : "space-y-6"}>
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Extraction engine</p>
            <p style={{ fontSize: "12.5px", color: "var(--ink-soft)", marginTop: 3, maxWidth: "30rem" }}>
              How screenshots are read. Local OCR is free and runs in your browser; AI Vision (Gemini or
              Claude) is far more accurate but uses an API key.
            </p>
          </div>
          <div className="seg" role="group" aria-label="Extraction engine">
            <button className="seg-item" aria-pressed={engine === "ocr"} onClick={() => setEngine("ocr")} disabled={portfolioBusy}>
              Local OCR · free
            </button>
            <button
              className="seg-item"
              aria-pressed={engine === "vision"}
              disabled={!visionAvailable || portfolioBusy}
              title={visionAvailable ? "" : "Set GEMINI_API_KEY (or ANTHROPIC_API_KEY) on the server to enable"}
              onClick={() => setEngine("vision")}
            >
              AI Vision {visionAvailable ? `· ${providerLabel}` : "· set key"}
            </button>
          </div>
        </div>

        <ModelSection
          aliases={aliases}
          engine={engine}
          portfolioId={selectedId}
          onModelChange={setModel}
          onSaved={(saved) => {
            setModel(saved.holdings);
            setModelSaved(true);
            void refreshPortfolios();
          }}
        />

        <ActualSection
          aliases={aliases}
          engine={engine}
          rows={actual}
          setRows={setActual}
          portfolioId={selectedId}
          portfolioSize={portfolioSize}
          setPortfolioSize={setPortfolioSizeForCurrent}
        />

        <PlanSection actual={actual} model={model} modelSaved={modelSaved} portfolioId={selectedId} />
      </div>
    </div>
  );
}
