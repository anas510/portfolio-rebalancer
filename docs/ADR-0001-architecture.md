# ADR-0001: Architecture & key technology choices

- Status: Accepted
- Date: 2026-07-26

## Context
The user needs a Next.js + TypeScript app to rebalance a PSX portfolio against a model
portfolio. Requirements: SQLite for memory, image parsing for both the model and the current
portfolio, a tabular buy/sell plan, and manual/CSV entry for the current portfolio. The user
prioritises **zero cost** and **free hosting on Vercel**.

## Decisions

### 1. Local OCR (`tesseract.js`) instead of a paid vision API
Claude/OpenAI vision would parse the screenshots more accurately but cost money and require an
API key — incompatible with the "free" requirement. `tesseract.js` runs in the browser at zero
cost and keeps images off any server (good for a free Vercel deploy). OCR output is always shown
in an **editable table** so the user can correct mistakes; **CSV and manual entry** are provided
as fully-reliable alternatives.

### 2. `@libsql/client` for both local file and Turso
The user asked for SQLite, but Vercel's serverless filesystem is ephemeral, so a local file
won't persist in that environment. `@libsql/client` speaks SQLite for **both** a local file
(`file:./data/portfolio.db`) and a remote **Turso** database (`libsql://…`). A single code path
selects the backend from env vars — local by default, Turso when `TURSO_DATABASE_URL` is set.
This satisfies "future-proof it (both local and Vercel)" without a second DB library or a native
`better-sqlite3` build.

### 3. Symbol alias table to reconcile names ↔ tickers
The model-portfolio screenshot lists **full company names**; the holdings screenshot lists
**tickers**. A seeded `symbol_alias` table plus a tolerant resolver (`src/lib/symbols.ts`) maps
both to a canonical ticker so the two data sources can be compared.

### 4. Persist only the model; read the actual portfolio fresh
Per the requirement, the model portfolio is stored in SQLite and reused; the actual portfolio is
parsed on demand. Generated plans may be logged to `rebalance_run` for history, but that is not a
source of truth.

### 5. Prices from the image, with optional best-effort live PSX fetch
The holdings screenshot already contains quantity + current price, so no external call is needed.
An optional scrape of the PSX data portal (`src/lib/psx.ts`) can fill missing prices but fails
gracefully — it never blocks plan generation.

## Consequences
- Fully runnable and hostable for free.
- OCR accuracy is the main limitation; mitigated by editable tables + CSV/manual entry.
- Live PSX scraping may break if the portal changes; treated as best-effort only.

## Addendum (2026-07-26): OCR accuracy + optional Claude Vision
Local tesseract OCR performed poorly on the dense, coloured PSX holdings table. Mitigations added
while keeping the free path default:
- **Preprocessing** (`src/lib/preprocess.ts`): upscale + greyscale + contrast before OCR.
- **Engine tuning** (`src/lib/ocr.ts`): tesseract worker with per-image page-segmentation mode.
- **Fuzzy symbol snapping** (`src/lib/symbols.ts`): Levenshtein snap of garbled tokens to the known
  symbol universe, with conservative tolerances (e.g. OGDC must NOT collapse to DGKC).
- **Optional Claude Vision** (`src/lib/vision.ts`, `/api/extract`, `/api/config`): enabled only when
  `ANTHROPIC_API_KEY` is set and the user picks the "Claude Vision" toggle. Calls the Anthropic
  Messages API via `fetch` (no SDK dependency), returns structured JSON, reconciled through the same
  symbol resolver. Default remains free local OCR; the key stays server-side.

## Addendum (2026-07-26): multi-provider AI Vision
Claude API access wasn't available to the user, so the vision layer was generalised to support
multiple providers behind one interface (`src/lib/vision.ts`):
- **Google Gemini** (`GEMINI_API_KEY`, default model `gemini-2.5-flash`) via
  `POST /v1beta/models/{model}:generateContent` with `inline_data` + `responseMimeType: application/json`.
  Preferred because it has a free tier.
- **Anthropic Claude** (`ANTHROPIC_API_KEY`) via the Messages API, retained.
Provider is auto-selected by whichever key is present; `VISION_PROVIDER` forces one when both exist.
Response-text extraction is provider-specific but the JSON→holdings mapping and symbol reconciliation
are shared. The UI toggle is now provider-agnostic ("AI Vision"); `/api/config` reports the active
provider. Default remains free local OCR; keys stay server-side.

## Addendum (2026-07-26): deterministic current-portfolio import
AI Vision and OCR both struggled with the dense zar.sarmaaya holdings grid (few/incorrect rows),
while the model-portfolio legend worked. Since the saved page contains the exact table, we added a
**deterministic HTML importer** (`parseHoldingsHtml` in `src/lib/parse.ts`): it locates the holdings
table, reads columns by header, takes each ticker from the row's `/stock/` link (robust to logo
letters like "G GCWL"), and reads the CASH row's amount. Stock market value is left to
quantity × current price for exactness. Verified against the user's real saved page (all 13 rows).
Also added a CSV/units workflow: `Fetch PSX prices` (best-effort, manual override) + a portfolio-size
input where `cash = size − Σ(holdings)`. HTML import is now the recommended primary path; AI Vision/OCR
remain as secondary options.

## Addendum (2026-07-26): holdings UX + reliable prices
- Section 02 controls grouped into Import (HTML/CSV/Screenshot) vs Manual (add row/cash) with a
  divider, plus a separate "Value from units" panel (Fetch PSX prices, portfolio size, set cash).
- The actual-holdings table now shows **computed Market value (= qty × price) and %** columns
  (position value ÷ total); the confusing editable market-value field was removed. Cash value stays
  editable. This also fixes a bug where a stray per-row `value` equal to the price skewed totals.
- After any import, missing prices are **auto-fetched** (only the blanks — HTML import already carries
  prices, so nothing is overwritten).
- `src/lib/psx.ts` now prefers PSX's per-symbol intraday timeseries JSON
  (`/timeseries/int/<SYMBOL>`) and falls back to scraping market-watch. Still best-effort.

## Addendum (2026-07-26): portfolios, saved holdings, partial rebalance, valuation fix
- **Valuation bug fix:** `holdingValue` in `rebalance.ts` now values stocks strictly as
  quantity × price and ignores any per-row `value` (only CASH keeps an explicit value). Previously a
  stale `value` (≈ price) made investable-total collapse and price edits have no effect.
- **Partial rebalance:** `rebalance({ rebalanceSymbols })` trades only the listed symbols; all other
  holdings are forced to HOLD. Surfaced as a "Whole portfolio / Selected shares only" control.
- **Multiple portfolios:** new `portfolio` + `portfolio_holding` tables. Each portfolio owns a saved
  holdings snapshot and either shares the default model or overrides it via `portfolio.model_id`.
  New routes: `/api/portfolios` (list/create/select/rename/delete), `/api/holdings` (GET/PUT).
  `/api/model` and `/api/plan` now resolve the effective model for the selected portfolio, and the
  model save takes a scope ("default" shared vs "custom" per-portfolio).
