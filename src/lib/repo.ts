// ---------------------------------------------------------------------------
// Repository: typed data-access helpers on top of the libsql client.
//
// Model portfolios live in `model_portfolio` (+ `model_holding`). The row with
// is_active = 1 is the shared DEFAULT model per user. A named `portfolio` may
// override it via model_id. Each portfolio also owns a saved holdings snapshot.
// ---------------------------------------------------------------------------

import { db } from "./db";
import type { ActualHolding, ModelHolding, ModelPortfolio, PortfolioSummary } from "./types";
import type { SymbolAlias } from "./symbols";

type Row = Record<string, unknown>;

class ForbiddenError extends Error {
  status = 403;
  constructor(message = "Forbidden") {
    super(message);
  }
}

async function assertPortfolioOwner(userId: number, portfolioId: number): Promise<void> {
  const client = await db();
  const res = await client.execute({ sql: "SELECT id FROM portfolio WHERE id = ? AND user_id = ?", args: [portfolioId, userId] });
  if (res.rows.length === 0) throw new ForbiddenError("Portfolio not found.");
}

// ---- Symbol aliases (global) ----------------------------------------------

export async function getAliases(): Promise<SymbolAlias[]> {
  const client = await db();
  const res = await client.execute("SELECT symbol, name FROM symbol_alias ORDER BY symbol");
  return res.rows.map((r) => ({ symbol: String((r as Row).symbol), name: String((r as Row).name) }));
}

export async function addAlias(symbol: string, name: string): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "INSERT OR IGNORE INTO symbol_alias (symbol, name) VALUES (?, ?)",
    args: [symbol.trim().toUpperCase(), name.trim()],
  });
}

export async function deleteAlias(symbol: string, name: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM symbol_alias WHERE symbol = ? AND name = ?", args: [symbol, name] });
}

// ---- Models ---------------------------------------------------------------

async function modelById(id: number): Promise<ModelPortfolio | null> {
  const client = await db();
  const mp = await client.execute({ sql: "SELECT id, name, updated_at FROM model_portfolio WHERE id = ?", args: [id] });
  if (mp.rows.length === 0) return null;
  const row = mp.rows[0] as Row;
  const holdings = await client.execute({
    sql: "SELECT symbol, name, target_pct FROM model_holding WHERE model_id = ? ORDER BY target_pct DESC",
    args: [id],
  });
  return {
    id,
    name: String(row.name),
    updatedAt: String(row.updated_at),
    holdings: holdings.rows.map((h) => {
      const hr = h as Row;
      return { symbol: String(hr.symbol), name: hr.name ? String(hr.name) : undefined, targetPct: Number(hr.target_pct) };
    }),
  };
}

/** The shared default model for a user (is_active = 1), or null if none saved yet. */
export async function getDefaultModel(userId: number): Promise<ModelPortfolio | null> {
  const client = await db();
  const mp = await client.execute({
    sql: "SELECT id FROM model_portfolio WHERE is_active = 1 AND user_id = ? ORDER BY id DESC LIMIT 1",
    args: [userId],
  });
  if (mp.rows.length === 0) return null;
  return modelById(Number((mp.rows[0] as Row).id));
}

/** Back-compat alias used by older callers. */
export const getActiveModel = getDefaultModel;

async function insertModel(userId: number, name: string, holdings: ModelHolding[], isDefault: boolean): Promise<number> {
  const client = await db();
  if (isDefault) {
    await client.execute({
      sql: "UPDATE model_portfolio SET is_active = 0 WHERE is_active = 1 AND user_id = ?",
      args: [userId],
    });
  }
  const inserted = await client.execute({
    sql: "INSERT INTO model_portfolio (name, is_active, user_id, updated_at) VALUES (?, ?, ?, datetime('now'))",
    args: [name || "Model Portfolio", isDefault ? 1 : 0, userId],
  });
  const modelId = Number(inserted.lastInsertRowid);
  for (const h of holdings) {
    await client.execute({
      sql: "INSERT INTO model_holding (model_id, symbol, name, target_pct) VALUES (?, ?, ?, ?)",
      args: [modelId, h.symbol.toUpperCase(), h.name ?? null, h.targetPct],
    });
  }
  return modelId;
}

/** Save the shared default model for a user (replaces the previous default). */
export async function saveDefaultModel(userId: number, name: string, holdings: ModelHolding[]): Promise<ModelPortfolio> {
  await insertModel(userId, name, holdings, true);
  return (await getDefaultModel(userId))!;
}

/** Back-compat alias. */
export const saveModel = saveDefaultModel;

/** The effective model for a portfolio: its custom model, else the user's default. */
export async function getEffectiveModel(userId: number, portfolioId: number): Promise<ModelPortfolio | null> {
  await assertPortfolioOwner(userId, portfolioId);
  const client = await db();
  const p = await client.execute({ sql: "SELECT model_id FROM portfolio WHERE id = ?", args: [portfolioId] });
  const modelId = p.rows.length ? (p.rows[0] as Row).model_id : null;
  if (modelId != null) {
    const m = await modelById(Number(modelId));
    if (m) return m;
  }
  return getDefaultModel(userId);
}

/**
 * Save a model for a portfolio. scope "default" updates the shared model;
 * "custom" creates a model owned by this portfolio and points it there.
 */
export async function saveModelForPortfolio(
  userId: number,
  portfolioId: number,
  name: string,
  holdings: ModelHolding[],
  scope: "default" | "custom"
): Promise<ModelPortfolio> {
  await assertPortfolioOwner(userId, portfolioId);
  const client = await db();
  if (scope === "default") {
    const m = await saveDefaultModel(userId, name, holdings);
    await client.execute({ sql: "UPDATE portfolio SET model_id = NULL, updated_at = datetime('now') WHERE id = ?", args: [portfolioId] });
    return m;
  }
  const modelId = await insertModel(userId, name, holdings, false);
  await client.execute({ sql: "UPDATE portfolio SET model_id = ?, updated_at = datetime('now') WHERE id = ?", args: [modelId, portfolioId] });
  return (await modelById(modelId))!;
}

/** Reset a portfolio to the shared default model. */
export async function usePortfolioDefaultModel(userId: number, portfolioId: number): Promise<void> {
  await assertPortfolioOwner(userId, portfolioId);
  const client = await db();
  await client.execute({ sql: "UPDATE portfolio SET model_id = NULL, updated_at = datetime('now') WHERE id = ?", args: [portfolioId] });
}

// ---- Portfolios -----------------------------------------------------------

async function countPortfolios(userId: number): Promise<number> {
  const client = await db();
  const c = await client.execute({ sql: "SELECT COUNT(*) AS c FROM portfolio WHERE user_id = ?", args: [userId] });
  return Number((c.rows[0] as Row).c ?? 0);
}

/** Guarantee at least one portfolio exists and exactly one is selected for this user. */
export async function ensurePortfolio(userId: number): Promise<void> {
  const client = await db();
  if ((await countPortfolios(userId)) === 0) {
    await client.execute({
      sql: "INSERT INTO portfolio (name, is_selected, user_id, updated_at) VALUES ('My Portfolio', 1, ?, datetime('now'))",
      args: [userId],
    });
    return;
  }
  const sel = await client.execute({
    sql: "SELECT COUNT(*) AS c FROM portfolio WHERE user_id = ? AND is_selected = 1",
    args: [userId],
  });
  if (Number((sel.rows[0] as Row).c ?? 0) === 0) {
    await client.execute({
      sql: "UPDATE portfolio SET is_selected = 1 WHERE id = (SELECT id FROM portfolio WHERE user_id = ? ORDER BY id LIMIT 1)",
      args: [userId],
    });
  }
}

export async function listPortfolios(userId: number): Promise<PortfolioSummary[]> {
  await ensurePortfolio(userId);
  const client = await db();
  const res = await client.execute({
    sql: "SELECT id, name, model_id, updated_at FROM portfolio WHERE user_id = ? ORDER BY id",
    args: [userId],
  });
  return res.rows.map((r) => {
    const row = r as Row;
    return {
      id: Number(row.id),
      name: String(row.name),
      hasCustomModel: row.model_id != null,
      updatedAt: String(row.updated_at),
    } satisfies PortfolioSummary;
  });
}

export async function getSelectedPortfolioId(userId: number): Promise<number> {
  await ensurePortfolio(userId);
  const client = await db();
  const res = await client.execute({
    sql: "SELECT id FROM portfolio WHERE user_id = ? AND is_selected = 1 ORDER BY id LIMIT 1",
    args: [userId],
  });
  return Number((res.rows[0] as Row).id);
}

export async function selectPortfolio(userId: number, id: number): Promise<void> {
  await assertPortfolioOwner(userId, id);
  const client = await db();
  await client.execute({ sql: "UPDATE portfolio SET is_selected = 0 WHERE user_id = ? AND is_selected = 1", args: [userId] });
  await client.execute({ sql: "UPDATE portfolio SET is_selected = 1 WHERE id = ? AND user_id = ?", args: [id, userId] });
}

export async function createPortfolio(userId: number, name: string): Promise<number> {
  const client = await db();
  await client.execute({ sql: "UPDATE portfolio SET is_selected = 0 WHERE user_id = ? AND is_selected = 1", args: [userId] });
  const res = await client.execute({
    sql: "INSERT INTO portfolio (name, is_selected, user_id, updated_at) VALUES (?, 1, ?, datetime('now'))",
    args: [name || "Portfolio", userId],
  });
  return Number(res.lastInsertRowid);
}

export async function renamePortfolio(userId: number, id: number, name: string): Promise<void> {
  await assertPortfolioOwner(userId, id);
  const client = await db();
  await client.execute({ sql: "UPDATE portfolio SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?", args: [name, id, userId] });
}

export async function deletePortfolio(userId: number, id: number): Promise<void> {
  await assertPortfolioOwner(userId, id);
  const client = await db();
  await client.execute({ sql: "DELETE FROM portfolio_holding WHERE portfolio_id = ?", args: [id] });
  await client.execute({ sql: "DELETE FROM portfolio WHERE id = ? AND user_id = ?", args: [id, userId] });
  await ensurePortfolio(userId);
}

// ---- Portfolio holdings ---------------------------------------------------

export async function getPortfolioHoldings(
  userId: number,
  id: number
): Promise<{ holdings: ActualHolding[]; targetSize: number | null }> {
  await assertPortfolioOwner(userId, id);
  const client = await db();
  const meta = await client.execute({
    sql: "SELECT target_size FROM portfolio WHERE id = ?",
    args: [id],
  });
  const targetSizeRaw = meta.rows.length ? (meta.rows[0] as Row).target_size : null;
  const targetSizeNum = targetSizeRaw == null ? NaN : Number(targetSizeRaw);
  const targetSize = Number.isFinite(targetSizeNum) && targetSizeNum > 0 ? targetSizeNum : null;

  const res = await client.execute({
    sql: "SELECT symbol, name, quantity, price, value FROM portfolio_holding WHERE portfolio_id = ? ORDER BY id",
    args: [id],
  });
  const holdings = res.rows.map((r) => {
    const row = r as Row;
    return {
      symbol: String(row.symbol),
      name: row.name ? String(row.name) : undefined,
      quantity: Number(row.quantity),
      price: Number(row.price),
      value: row.value == null ? undefined : Number(row.value),
    } satisfies ActualHolding;
  });
  return { holdings, targetSize };
}

export async function savePortfolioHoldings(
  userId: number,
  id: number,
  holdings: ActualHolding[],
  targetSize?: number | null
): Promise<void> {
  await assertPortfolioOwner(userId, id);
  const client = await db();
  await client.execute({ sql: "DELETE FROM portfolio_holding WHERE portfolio_id = ?", args: [id] });
  for (const h of holdings) {
    if (!h.symbol) continue;
    await client.execute({
      sql: "INSERT INTO portfolio_holding (portfolio_id, symbol, name, quantity, price, value) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, h.symbol.toUpperCase(), h.name ?? null, h.quantity || 0, h.price || 0, h.value ?? null],
    });
  }
  if (targetSize !== undefined) {
    await client.execute({
      sql: "UPDATE portfolio SET target_size = ?, updated_at = datetime('now') WHERE id = ?",
      args: [targetSize != null && targetSize > 0 ? targetSize : null, id],
    });
  } else {
    await client.execute({ sql: "UPDATE portfolio SET updated_at = datetime('now') WHERE id = ?", args: [id] });
  }
}

// ---- Run history ----------------------------------------------------------

export async function saveRun(userId: number, cashAvailable: number, investableTotal: number, planJson: string): Promise<number> {
  const client = await db();
  const res = await client.execute({
    sql: "INSERT INTO rebalance_run (user_id, cash_available, investable_total, plan_json) VALUES (?, ?, ?, ?)",
    args: [userId, cashAvailable, investableTotal, planJson],
  });
  return Number(res.lastInsertRowid);
}

export { ForbiddenError };
