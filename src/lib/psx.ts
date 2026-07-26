// ---------------------------------------------------------------------------
// Best-effort LIVE price fetch from the PSX data portal.
//
// OPTIONAL. The app works fully offline using prices from the imported page /
// manual entry. When enabled we try, in order:
//   1. Per-symbol intraday timeseries JSON (most reliable):
//      https://dps.psx.com.pk/timeseries/int/<SYMBOL>  -> { data: [[ts, price, vol], ...] }
//   2. Fallback: scrape the market-watch HTML table.
// Any failure is swallowed and returns an empty map, so plan generation never
// breaks. Runs server-side only.
//
// NOTE: PSX may change/protect these endpoints; treat failures as normal and
// rely on the HTML import (which already contains current prices).
// ---------------------------------------------------------------------------

const TIMESERIES = (sym: string) => `https://dps.psx.com.pk/timeseries/int/${encodeURIComponent(sym)}`;
const MARKET_WATCH = "https://dps.psx.com.pk/market-watch";
const UA = "Mozilla/5.0 (compatible; PortfolioRebalancer/1.0)";

let _cache: { at: number; prices: Map<string, number> } | null = null;
const CACHE_MS = 60_000;

export async function fetchLivePrices(symbols?: string[]): Promise<Map<string, number>> {
  if (process.env.ENABLE_LIVE_PSX_PRICES === "false") return new Map();

  const wanted = (symbols ?? []).map((s) => s.toUpperCase()).filter((s) => s && s !== "CASH");
  if (wanted.length === 0) return new Map();

  // Serve from cache when it already covers everything requested.
  if (_cache && Date.now() - _cache.at < CACHE_MS && wanted.every((s) => _cache!.prices.has(s))) {
    return pick(_cache.prices, wanted);
  }

  const out = new Map<string, number>();

  // 1) Per-symbol timeseries JSON (concurrent, best-effort).
  await Promise.allSettled(
    wanted.map(async (sym) => {
      const p = await fetchTimeseriesPrice(sym);
      if (p != null) out.set(sym, p);
    })
  );

  // 2) Fallback scrape for anything still missing.
  if (out.size < wanted.length) {
    const scraped = await scrapeMarketWatch().catch(() => new Map<string, number>());
    for (const s of wanted) if (!out.has(s) && scraped.has(s)) out.set(s, scraped.get(s)!);
  }

  // Merge into cache.
  const merged = new Map(_cache?.prices ?? []);
  for (const [k, v] of out) merged.set(k, v);
  _cache = { at: Date.now(), prices: merged };

  return out;
}

async function fetchTimeseriesPrice(sym: string): Promise<number | null> {
  try {
    const res = await fetch(TIMESERIES(sym), {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<[number, number, number]> };
    const data = json.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    // Pick the entry with the greatest timestamp (most recent).
    let latest = data[0];
    for (const row of data) if (Array.isArray(row) && row[0] > latest[0]) latest = row;
    const price = Number(latest[1]);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

function pick(prices: Map<string, number>, wanted: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of wanted) if (prices.has(s)) out.set(s, prices.get(s)!);
  return out;
}

/** Defensive scrape of the market-watch table (symbol cell + a numeric cell). */
async function scrapeMarketWatch(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch(MARKET_WATCH, { headers: { "User-Agent": UA, Accept: "text/html" }, cache: "no-store" });
    if (!res.ok) return map;
    const html = await res.text();
    const cellRegex = />\s*([A-Z]{2,8})\s*<\/td>[\s\S]{0,600}?data-order="?([\d.]+)"?/g;
    let m: RegExpExecArray | null;
    while ((m = cellRegex.exec(html)) !== null) {
      const sym = m[1];
      const price = parseFloat(m[2]);
      if (sym && Number.isFinite(price) && price > 0 && !map.has(sym)) map.set(sym, price);
    }
  } catch {
    /* ignore */
  }
  return map;
}
