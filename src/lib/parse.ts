// ---------------------------------------------------------------------------
// Parsers: turn raw OCR text or CSV into structured holdings.
//
// OCR of dense tables is inherently noisy, so these parsers are best-effort:
// their output is always shown in an EDITABLE table in the UI so the user can
// correct mistakes before generating a plan. Manual entry and CSV import are
// the fully-reliable paths.
// ---------------------------------------------------------------------------

import type { ActualHolding, ModelHolding } from "./types";
import { resolveSymbol, type SymbolAlias } from "./symbols";

/**
 * Parse numbers that may carry K/M/B suffixes, commas, or currency noise.
 * "1.11M" -> 1_110_000 ; "919.88K" -> 919_880 ; "11,250" -> 11250
 */
export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s₨rs]/gi, "").replace(/pkr/gi, "");
  const m = cleaned.match(/^-?\d*\.?\d+([kmb])?$/i);
  if (!m) {
    const digits = cleaned.replace(/[^0-9.\-]/g, "");
    if (digits === "" || digits === "-" || digits === ".") return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  let n = parseFloat(cleaned);
  const suffix = (m[1] || "").toLowerCase();
  if (suffix === "k") n *= 1_000;
  else if (suffix === "m") n *= 1_000_000;
  else if (suffix === "b") n *= 1_000_000_000;
  return Number.isFinite(n) ? n : null;
}

// ---- Model portfolio (names + percentages) --------------------------------

/**
 * Extract { name, targetPct } pairs from model-portfolio OCR text.
 * Looks for a label immediately followed by an NN% token, tolerant of the
 * label wrapping across lines.
 */
export function parseModelText(text: string, aliases: SymbolAlias[]): ModelHolding[] {
  const out: ModelHolding[] = [];
  // Collapse the whole blob; percentages are the reliable anchors.
  const flat = text.replace(/\r/g, "\n");
  const regex = /([A-Za-z][A-Za-z.&'()\- ]{1,60}?)\s*(\d{1,3})\s*%/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(flat)) !== null) {
    const rawName = match[1].replace(/\s+/g, " ").trim();
    const pct = Number(match[2]);
    if (!rawName || pct <= 0 || pct > 100) continue;
    // Drop obvious headers / stray words.
    if (/model|portfolio|advisory|shariah|compliant|value/i.test(rawName) && rawName.split(" ").length <= 2) {
      continue;
    }
    const symbol = resolveSymbol(rawName, aliases);
    if (out.some((o) => o.symbol === symbol)) continue;
    out.push({ symbol, name: rawName, targetPct: pct });
  }
  return out;
}

// ---- Actual portfolio (OCR of the holdings table) -------------------------

/**
 * Best-effort parse of the PSX "Portfolio Holdings" table OCR.
 * Heuristic per line: first ALL-CAPS token = ticker; following numbers map to
 * quantity, avg price, current price, ... , market value. The CASH row carries
 * only an amount.
 */
export function parseActualText(text: string, aliases: SymbolAlias[]): ActualHolding[] {
  const out: ActualHolding[] = [];
  const lines = text.split(/\n+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tickerMatch = trimmed.match(/^([A-Z]{2,8})\b/);
    if (!tickerMatch) continue;
    const ticker = tickerMatch[1];
    if (/^(SYMBOL|QUANTITY|AVG|CURR|TODAY|MARKET|PORTFOLIO|SEARCH|FILT)/i.test(ticker)) continue;

    const rest = trimmed.slice(tickerMatch[0].length);
    const numTokens = rest.match(/-?[\d,]+\.?\d*[KMB]?%?/gi) ?? [];
    const nums = numTokens
      .filter((t) => !t.includes("%"))
      .map((t) => parseNumber(t))
      .filter((n): n is number => n !== null);

    if (ticker.toUpperCase() === "CASH") {
      // CASH line: the amount is the (usually large) first value.
      const amount = nums.find((n) => n > 1000) ?? nums[0] ?? 0;
      out.push({ symbol: "CASH", name: "Cash", quantity: 0, price: 1, value: amount });
      continue;
    }

    if (nums.length === 0) continue;
    const symbol = resolveSymbol(ticker, aliases);
    const quantity = nums[0] ?? 0;
    // current price is typically the 2nd/3rd number; market value the largest.
    const price = nums[2] ?? nums[1] ?? 0;
    const value = nums.length >= 4 ? Math.max(...nums.slice(3)) : undefined;
    out.push({ symbol, name: ticker, quantity, price, value });
  }
  return out;
}

// ---- Actual portfolio (CSV) ----------------------------------------------

/**
 * Flexible CSV import. Recognised headers (case-insensitive):
 *   symbol | ticker
 *   quantity | qty | units | shares
 *   price | curr price | current price | last
 *   value | market value | amount
 * A row whose symbol is CASH uses its value/amount as the cash balance.
 */
export function parseActualCsv(csv: string, aliases: SymbolAlias[]): ActualHolding[] {
  const rows = csv
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows.length === 0) return [];

  const split = (line: string) => line.split(",").map((c) => c.trim());
  const header = split(rows[0]).map((h) => h.toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));

  const iSymbol = idx(["symbol", "ticker", "scrip", "stock"]);
  const iQty = idx(["quantity", "qty", "units", "shares"]);
  const iPrice = idx(["price", "curr price", "current price", "curr. price", "last", "rate"]);
  const iValue = idx(["value", "market value", "amount", "mkt value"]);

  const hasHeader = iSymbol !== -1;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const out: ActualHolding[] = [];
  for (const line of dataRows) {
    const cols = split(line);
    const rawSymbol = hasHeader ? cols[iSymbol] : cols[0];
    if (!rawSymbol) continue;
    const symbol = resolveSymbol(rawSymbol, aliases);
    const quantity = parseNumber(hasHeader && iQty !== -1 ? cols[iQty] : cols[1]) ?? 0;
    const price = parseNumber(hasHeader && iPrice !== -1 ? cols[iPrice] : cols[2]) ?? 0;
    const value = parseNumber(hasHeader && iValue !== -1 ? cols[iValue] : cols[3] ?? "") ?? undefined;

    if (symbol === "CASH") {
      out.push({ symbol, name: "Cash", quantity: 0, price: 1, value: value ?? quantity });
      continue;
    }
    out.push({ symbol, name: rawSymbol, quantity, price, value: value ?? undefined });
  }
  return out;
}

// ---- Actual portfolio (saved HTML page, e.g. zar.sarmaaya) ----------------

/** Strip a table cell's inner HTML down to visible text. */
function cleanCell(inner: string): string {
  return inner
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ") // drop inline icons
    .replace(/<[^>]+>/g, " ") // drop tags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First numeric token in a string, honouring K/M/B suffixes ("amount 1.11M" -> 1110000). */
export function firstNumberToken(text: string): number | null {
  const m = text.match(/-?[\d,]+\.?\d*\s*[kmb]?/i);
  return m ? parseNumber(m[0]) : null;
}

/**
 * Parse a saved brokerage holdings page (deterministic — no OCR/AI).
 * Targets the holdings <table>, reads columns by header when available, takes
 * the ticker from each row's stock link (robust to logo letters like "G GCWL"),
 * and treats the CASH row's amount specially. Stock market value is left to
 * quantity × current price for exactness.
 */
export function parseHoldingsHtml(htmlStr: string, aliases: SymbolAlias[]): ActualHolding[] {
  const tables = htmlStr.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const tbl = tables.find((t) => /portfolio\s*%|market\s*value/i.test(t)) ?? tables[0];
  if (!tbl) return [];

  const rows = tbl.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

  // Resolve column indices from the header row (fall back to the known layout).
  let idxQty = 1;
  let idxCurr = 3;
  let idxMv = 6;
  const headerRow = rows.find((r) => /<th\b/i.test(r));
  if (headerRow) {
    const ths = [...headerRow.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => cleanCell(m[1]).toLowerCase());
    const find = (...keys: string[]) => ths.findIndex((h) => keys.some((k) => h.includes(k)));
    const q = find("quantity", "qty", "units");
    const c = find("curr. price", "curr price", "current", "last");
    const mv = find("market value", "mkt value");
    if (q >= 0) idxQty = q;
    if (c >= 0) idxCurr = c;
    if (mv >= 0) idxMv = mv;
  }

  const out: ActualHolding[] = [];
  for (const row of rows) {
    if (/<th\b/i.test(row)) continue; // skip header
    const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanCell(m[1]));
    if (tds.length < 2) continue;

    const symCell = tds[0] ?? "";

    // CASH row: amount lives in the quantity/first cell ("amount 1.11M").
    if (/\bcash\b/i.test(symCell) || /\bamount\b/i.test(symCell) || /\bcash\b/i.test(tds[idxQty] ?? "")) {
      const amt =
        firstNumberToken(tds[idxQty] ?? "") ??
        firstNumberToken(tds[idxMv] ?? "") ??
        firstNumberToken(symCell) ??
        0;
      if (amt > 0) out.push({ symbol: "CASH", name: "Cash", quantity: 0, price: 1, value: amt });
      continue;
    }

    // Ticker: prefer the stock link text (avoids logo letters), else first token.
    const anchor = row.match(/<a\b[^>]*href="[^"]*stock\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    let ticker = anchor ? cleanCell(anchor[1]).split(/\s+/)[0] : "";
    if (!ticker) {
      const tokens = symCell.split(/\s+/);
      // If a leading single-letter logo slipped in, prefer the next token.
      ticker = tokens[0]?.length === 1 && tokens[1] ? tokens[1] : tokens[0] ?? "";
    }
    if (!ticker) continue;

    const symbol = resolveSymbol(ticker, aliases);
    const quantity = firstNumberToken(tds[idxQty] ?? "") ?? 0;
    const price = firstNumberToken(tds[idxCurr] ?? "") ?? 0;
    if (!quantity && !price) continue;

    out.push({ symbol, name: ticker, quantity, price, value: undefined });
  }
  return out;
}
