// ---------------------------------------------------------------------------
// Symbol resolution
//
// The MODEL portfolio image lists full company names ("Highnoon Laboratories
// Limited"), while the ACTUAL portfolio image lists PSX tickers ("HINOON").
// We resolve every name/ticker to a canonical ticker.
//
// Crucially, OCR mis-reads characters ("FABL" -> "FA8L", "TGL" -> "TGI"), so
// resolution is FUZZY: after exact/containment checks we snap the token to the
// nearest KNOWN symbol by edit distance. Because the set of symbols is small
// and finite, this corrects the vast majority of OCR symbol errors.
// ---------------------------------------------------------------------------

export interface SymbolAlias {
  /** Canonical PSX ticker. */
  symbol: string;
  /** Full company name as shown on the model portfolio. */
  name: string;
}

/**
 * Seed mappings derived from the user's Shariah Compliant Model Portfolio and
 * Portfolio Holdings screenshots. Extend freely (or via POST /api/symbols).
 */
export const SEED_ALIASES: SymbolAlias[] = [
  { symbol: "HINOON", name: "Highnoon Laboratories Limited" },
  { symbol: "ICL", name: "Ittehad Chemicals Limited" },
  { symbol: "DGKC", name: "D.G. Khan Cement Company Limited" },
  { symbol: "TGL", name: "Tariq Glass Industries Limited" },
  { symbol: "FABL", name: "Faysal Bank Limited" },
  { symbol: "AIRLINK", name: "Air Link Communication Limited" },
  { symbol: "SITC", name: "Sitara Chemical Industries Limited" },
  { symbol: "GCWL", name: "Ghani ChemWorld Limited" },
  { symbol: "GCIL", name: "Ghani Chemical Industries Limited" },
  { symbol: "GHNI", name: "Ghandhara Industries Limited" },
  { symbol: "ATRL", name: "Attock Refinery Limited" },
  { symbol: "NRL", name: "National Refinery Limited" },
  { symbol: "CASH", name: "Cash" },
];

/** Normalise a string for fuzzy comparison. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(limited|ltd|company|co|industries|laboratories|labs|inc|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Snap a possibly-garbled ticker token to the nearest known ticker.
 * Returns null if nothing is close enough (distance grows with length).
 */
function snapTicker(token: string, tickers: string[]): string | null {
  const t = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return null;
  if (tickers.includes(t)) return t;
  let best: string | null = null;
  let bestD = Infinity;
  for (const tk of tickers) {
    const d = levenshtein(t, tk);
    if (d < bestD) {
      bestD = d;
      best = tk;
    }
  }
  // Conservative tolerance to avoid "correcting" a genuinely different ticker
  // (e.g. OGDC is only 2 edits from DGKC): 1 edit for short tickers, scaling up
  // for longer ones where OCR noise is more likely and collisions rarer.
  const len = Math.max(best?.length ?? 0, t.length);
  const tolerance = len <= 4 ? 1 : len <= 6 ? 2 : 3;
  return best && bestD <= tolerance ? best : null;
}

/** Snap a possibly-garbled company name to the nearest known alias name. */
function snapName(raw: string, aliases: SymbolAlias[]): string | null {
  const norm = normalize(raw);
  if (norm.length < 3) return null;
  let best: SymbolAlias | null = null;
  let bestD = Infinity;
  for (const a of aliases) {
    const d = levenshtein(norm, normalize(a.name));
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  if (!best) return null;
  const target = normalize(best.name);
  // Accept if within 35% of the longer string's length.
  const tolerance = Math.ceil(Math.max(norm.length, target.length) * 0.35);
  return bestD <= tolerance ? best.symbol : null;
}

/**
 * Resolve a raw label (a ticker OR a company name, possibly OCR-garbled) to a
 * canonical ticker. Order: cash special-case -> exact ticker -> exact/partial
 * name -> fuzzy ticker snap -> fuzzy name snap -> uppercased fallback.
 */
export function resolveSymbol(raw: string, aliases: SymbolAlias[]): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const upper = trimmed.toUpperCase();
  if (/^(CASH|AMOUNT|CASHBALANCE)$/.test(upper.replace(/[^A-Z]/g, ""))) return "CASH";

  const tickers = Array.from(new Set(aliases.map((a) => a.symbol.toUpperCase())));

  // 1) Exact ticker.
  if (tickers.includes(upper.replace(/\s+/g, ""))) return upper.replace(/\s+/g, "");

  // 2) Exact / partial name.
  const norm = normalize(trimmed);
  const exactName = aliases.find((a) => normalize(a.name) === norm);
  if (exactName) return exactName.symbol;
  if (norm.length >= 3) {
    const partial = aliases.find((a) => {
      const an = normalize(a.name);
      return an.startsWith(norm) || norm.startsWith(an) || (an.length >= 5 && an.includes(norm));
    });
    if (partial) return partial.symbol;
  }

  // 3) Fuzzy snap. Short, ticker-like tokens -> nearest ticker; longer,
  //    space-containing labels -> nearest company name.
  const looksLikeTicker = /^[A-Za-z0-9]{2,10}$/.test(trimmed.replace(/\s+/g, "")) && !trimmed.includes(" ");
  if (looksLikeTicker) {
    const snapped = snapTicker(trimmed, tickers);
    if (snapped) return snapped;
  }
  const snappedName = snapName(trimmed, aliases);
  if (snappedName) return snappedName;

  // As a last resort, still try a loose ticker snap even for spaced tokens.
  const loose = snapTicker(trimmed.replace(/\s+/g, ""), tickers);
  if (loose) return loose;

  // 4) Fallback: assume it is already a (novel) ticker.
  return upper.replace(/\s+/g, "");
}
