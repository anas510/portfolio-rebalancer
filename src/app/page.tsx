"use client";

import { useCallback, useEffect, useState } from "react";
import ModelSection from "@/components/ModelSection";
import ActualSection from "@/components/ActualSection";
import PlanSection from "@/components/PlanSection";
import PortfolioBar from "@/components/PortfolioBar";
import type { SymbolAlias } from "@/lib/symbols";
import type { ActualHolding, PortfolioSummary } from "@/lib/types";

export type Engine = "ocr" | "vision";

export default function Home() {
  const [aliases, setAliases] = useState<SymbolAlias[]>([]);
  const [engine, setEngine] = useState<Engine>("ocr");
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [visionProvider, setVisionProvider] = useState<string | null>(null);

  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [actual, setActual] = useState<ActualHolding[]>([]);
  const [modelSaved, setModelSaved] = useState(false);

  const refreshPortfolios = useCallback(async () => {
    const d = await fetch("/api/portfolios").then((r) => r.json());
    setPortfolios(d.portfolios ?? []);
    setSelectedId((prev) => (d.selectedId ?? prev ?? null));
  }, []);

  // Load a portfolio's saved holdings + model status.
  const loadPortfolioData = useCallback(async (id: number) => {
    const [m, h] = await Promise.all([
      fetch(`/api/model?portfolioId=${id}`).then((r) => r.json()),
      fetch(`/api/holdings?portfolioId=${id}`).then((r) => r.json()),
    ]);
    setModelSaved(Boolean(m.model));
    setActual(h.holdings ?? []);
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
    refreshPortfolios();
  }, [refreshPortfolios]);

  useEffect(() => {
    if (selectedId != null) loadPortfolioData(selectedId);
  }, [selectedId, loadPortfolioData]);

  async function handleSelect(id: number) {
    await fetch("/api/portfolios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "select", id }),
    });
    setSelectedId(id);
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
        onSelect={handleSelect}
        onChanged={refreshPortfolios}
      />

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Extraction engine</p>
          <p style={{ fontSize: "12.5px", color: "var(--ink-soft)", marginTop: 3, maxWidth: "30rem" }}>
            How screenshots are read. Local OCR is free and runs in your browser; AI Vision (Gemini or
            Claude) is far more accurate but uses an API key.
          </p>
        </div>
        <div className="seg" role="group" aria-label="Extraction engine">
          <button className="seg-item" aria-pressed={engine === "ocr"} onClick={() => setEngine("ocr")}>
            Local OCR · free
          </button>
          <button
            className="seg-item"
            aria-pressed={engine === "vision"}
            disabled={!visionAvailable}
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
        onSaved={() => {
          setModelSaved(true);
          refreshPortfolios();
        }}
      />

      <ActualSection aliases={aliases} engine={engine} rows={actual} setRows={setActual} portfolioId={selectedId} />

      <PlanSection actual={actual} modelSaved={modelSaved} portfolioId={selectedId} />
    </div>
  );
}
