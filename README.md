# PSX Portfolio Rebalancer

A local-first **Next.js + TypeScript** app that tells you exactly how many shares of each
stock to **buy or sell** to bring your Pakistan Stock Exchange (PSX) portfolio in line with a
saved **model portfolio**.

- **Model portfolio** (target weights) is parsed once from an image, reviewed, and **saved in SQLite**. It's reused every time.
- **Current portfolio** (actual holdings) is read **fresh every time** — from a screenshot (browser OCR), a CSV, or manual entry.
- The app reconciles the two and produces a **tabular buy/sell plan** in whole shares, with a cash reconciliation and CSV export.

> ⚠️ This tool is a calculator, not investment advice. Always verify quantities and prices before trading.

---



## Why these design choices


| Concern                  | Decision                                                                                          | Reason                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Image parsing            | **Local OCR** (`tesseract.js`, runs in the browser)                                               | Zero cost, no API key, and free to host on Vercel. (Claude Vision would be more accurate but is paid.)                                 |
| Database                 | `@libsql/client` — one client, two backends                                                       | Local SQLite **file** for `npm run dev`; **Turso** (libSQL) when env vars are set, so it also runs on Vercel's ephemeral filesystem.   |
| Prices                   | From the **current-portfolio image / manual entry**, with **optional best-effort live PSX fetch** | The PSX holdings screenshot already contains quantity + current price, so no external call is required.                                |
| Model vs actual mismatch | **Symbol alias table**                                                                            | The model image uses full names ("Highnoon Laboratories Limited"); the holdings image uses tickers ("HINOON"). Aliases reconcile them. |


---



## Quick start (local)

```bash
npm install
npm run dev
# open http://localhost:3000
```

No configuration is needed. A SQLite file is created automatically at `./data/portfolio.db`
and seeded with the 13 symbol mappings from your model/holdings screenshots.

Optional: initialise the DB ahead of time with `npm run db:seed`.

### Try it with sample data

1. In **section 1**, upload `model-portfolio.png` (or click **+ Add row** and type weights), then **Save**.
2. In **section 2**, click **Import CSV** and pick `sample-portfolio.csv` (mirrors `portfolio.png`).
3. In **section 3**, click **Generate plan**.

---



## Deploying free on Vercel

Vercel's serverless filesystem is ephemeral, so a local SQLite file won't persist there.
Use **Turso** (free tier) instead — same SQLite, remote:

1. Create a free DB at [https://turso.tech](https://turso.tech) and grab its URL + auth token.
2. In Vercel → Project → Settings → Environment Variables, set:
  - `TURSO_DATABASE_URL = libsql://<your-db>.turso.io`
  - `TURSO_AUTH_TOKEN = <token>`
3. Deploy. When `TURSO_DATABASE_URL` is present the app automatically uses Turso; otherwise it uses the local file. **No code changes.**

See `.env.example` for all variables.

---



## OCR accuracy & tips

OCR of dense, coloured PSX tables is inherently error-prone. The app does several things to
maximise free (browser-side) accuracy:

- **Image preprocessing** (`src/lib/preprocess.ts`): upscales, converts to greyscale (removes
the coloured icon/P&L noise), and stretches contrast before OCR.
- **Engine tuning** (`src/lib/ocr.ts`): uses a tesseract worker with a page-segmentation mode
chosen per image (sparse-text for the holdings grid, single-block for the model legend).
- **Fuzzy symbol snapping** (`src/lib/symbols.ts`): every detected ticker/name is snapped to the
nearest **known** PSX symbol by edit distance, so `FA8L`→`FABL`, `TGI`→`TGL`,
`HIN00N`→`HINOON` are auto-corrected. (Snapping is conservative so a genuinely different
ticker like `OGDC` is left alone.)
- **Editable everything**: OCR output lands in an editable table, and a **"Show raw OCR text"**
box lets you fix the text and **re-parse** without re-running OCR.

**For the current portfolio, prefer importing the saved page (HTML) — it's the most accurate.**
`Import saved page (HTML)` reads the holdings table directly from a saved zar.sarmaaya page and
extracts exact units, current prices and the cash line with no OCR/AI and no rounding
(`parseHoldingsHtml` in `src/lib/parse.ts`). AI Vision and OCR remain available for screenshots,
but the dense holdings grid is hard for them.

**CSV / units workflow.** Import a CSV of `symbol, quantity, avg/current price` (or type rows in),
click **Fetch PSX prices** to fill current prices (best-effort; enter manually if the source is
blocked), then enter a **Total portfolio size** — cash and `%` columns update automatically
(`size − holdings`). Save holdings to persist the size per portfolio.

### Optional: AI Vision (accurate)

For near-perfect extraction, set ONE vision API key and an **"AI Vision"** toggle appears at the
top of the page. When selected, screenshots are sent to the provider server-side (the key never
reaches the browser) and returned as structured holdings. Two providers are supported and
auto-selected by whichever key is present (**Gemini preferred** — it has a free tier):

| Provider | Env var | Default model | Get a key |
| --- | --- | --- | --- |
| Google Gemini | `GEMINI_API_KEY` | `gemini-flash-latest` | https://aistudio.google.com/apikey (free) |
| Anthropic Claude | `ANTHROPIC_API_KEY` | `claude-sonnet-5` | https://console.anthropic.com/ (paid) |

Add to `.env.local` (or your Vercel env), then restart:

```
GEMINI_API_KEY="AIza..."
# optional overrides:
# GEMINI_MODEL="gemini-flash-latest"   # falls back to an auto-discovered model if unavailable
# VISION_PROVIDER="gemini"             # force a provider if both keys are set
```

The toggle enables automatically (via `GET /api/config`) and shows the active provider; it's
disabled and labelled "(set key)" when no key is present. **Local OCR stays the default**, so the
app is free unless you opt in.



## How the rebalancing works

1. **Investable total** = sum of all current holding values (including the CASH line) + optional new cash.
2. For each symbol, **target value** = investable total × model weight.
3. **Target units** = target value ÷ current price, rounded to a **whole share** (nearest, or "floor" to never over-buy).
4. **Δ units** = target units − current units → `BUY` (positive), `SELL` (negative), or `HOLD`.
5. Cash is the residual buffer; the plan shows **buy cash needed**, **sell proceeds**, and **cash remaining after trades**, plus warnings (weights ≠ 100%, missing prices, holdings not in the model, insufficient cash).

The algorithm lives in `src/lib/rebalance.ts` and is pure/unit-tested (`npm test`).

---



## Project structure

```
portfolio-rebalancer/
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx / page.tsx / globals.css   # UI shell + orchestrator
│  │  └─ api/
│  │     ├─ model/route.ts      # GET/POST saved model portfolio
│  │     ├─ plan/route.ts       # POST -> rebalancing plan
│  │     ├─ prices/route.ts     # GET  -> best-effort live PSX prices
│  │     ├─ symbols/route.ts    # GET/POST/DELETE symbol aliases
│  │     ├─ extract/route.ts    # POST -> Claude Vision extraction (opt-in)
│  │     └─ config/route.ts     # GET  -> feature flags (visionAvailable, …)
│  ├─ components/                # ModelSection, ActualSection, PlanSection, PortfolioBar, …
│  └─ lib/
│     ├─ db.ts          # libsql client (file or Turso) + schema init
│     ├─ repo.ts        # typed data-access helpers
│     ├─ types.ts       # domain types
│     ├─ portfolioValue.ts  # holding valuation, cash sync, portfolio size helpers
│     ├─ symbols.ts     # seed aliases + fuzzy resolver/snapping
│     ├─ ocr.ts         # tesseract.js (browser) worker
│     ├─ preprocess.ts  # canvas greyscale/contrast/upscale for OCR
│     ├─ parse.ts       # OCR-text + CSV parsers
│     ├─ vision.ts      # optional Claude Vision extraction (server)
│     ├─ extractClient.ts # browser helper -> /api/extract
│     ├─ rebalance.ts   # pure rebalancing algorithm  ← core logic
│     ├─ psx.ts         # optional live price scrape
│     └─ format.ts      # PKR / % formatting
├─ scripts/seed.ts    # npm run db:seed
├─ __tests__/         # vitest unit tests
├─ docs/ADR-0001-architecture.md
├─ .agents/           # guidance for AI agents working on this repo
├─ .claude/CLAUDE.md  # project memory for Claude
├─ sample-portfolio.csv
└─ .env.example
```

---



## Data model (SQLite)

- `model_portfolio (id, name, is_active, updated_at)` — model library; `is_active = 1` marks the shared **default** model.
- `model_holding (id, model_id, symbol, name, target_pct)` — target weights.
- `portfolio (id, name, model_id, is_selected, target_size, updated_at)` — named portfolios; `model_id` NULL means "use the shared default model", otherwise a custom model for this portfolio. `target_size` stores the optional total portfolio size (PKR) used to derive cash.
- `portfolio_holding (id, portfolio_id, symbol, name, quantity, price, value)` — saved current-holdings snapshot per portfolio.
- `symbol_alias (symbol, name)` — ticker ⇄ company-name mappings.
- `rebalance_run (id, created_at, cash_available, investable_total, plan_json)` — plan history.

**Portfolios.** Use the portfolio bar to create/rename/delete/switch portfolios. A loading banner
and spinner appear while portfolios load or while switching — the main sections are dimmed and
non-interactive until the operation completes. Each portfolio keeps its own saved holdings and
**total portfolio size** (Save holdings / Load saved). The model is shared by default; when saving a model you
can choose **All portfolios (shared default)** or **Only this portfolio** (a custom override).

**Rebalance scope.** In the plan, choose **Whole portfolio** or **Selected shares only** (tick the
symbols to trade) — non-selected holdings are left untouched. After the first **Generate plan**,
the plan auto-updates when holdings, model weights, prices, cash, or portfolio options change.
Percentages are shown to **two decimal places**.

> Note: a stock's value is always `quantity × current price` — editing a price always updates the
> plan. Only the CASH line carries an explicit amount.

---



## Scripts


| Command                       | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `npm run dev`                 | Start the dev server                          |
| `npm run build` / `npm start` | Production build / serve                      |
| `npm test`                    | Run unit tests (rebalance algorithm, parsers) |
| `npm run db:seed`             | Create tables + seed aliases                  |
| `npm run lint`                | Next.js lint                                  |


---



## Extending it

- **New stock mappings:** add rows via the `POST /api/symbols` endpoint, or edit the `symbol_alias` table / `SEED_ALIASES` in `src/lib/symbols.ts`.
- **Different rounding / lot sizes:** adjust `src/lib/rebalance.ts`.
- **Better OCR accuracy:** swap `src/lib/ocr.ts` for a paid vision model (e.g. Claude), keeping `parse.ts` as the structuring layer.

See `docs/ADR-0001-architecture.md` for the reasoning behind the main decisions and
`.agents/README.md` for conventions to follow when changing the code.