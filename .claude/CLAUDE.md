# CLAUDE.md — project memory

This file gives Claude (and other AI agents) the context needed to work on this repo safely.

## What this app is
A local-first Next.js 14 (App Router) + TypeScript app that rebalances a **PSX** portfolio
against a saved **model portfolio**. See `README.md` for the full picture.

## Non-negotiable constraints
- **Do not delete files without explicit user confirmation.**
- **Free by default.** The default image reader is client-side OCR (`tesseract.js`) — no key, no cost. An **optional** AI Vision path exists (`src/lib/vision.ts`) supporting Google Gemini (default, free tier) and Anthropic Claude, auto-selected by whichever key is present. It is **off unless a vision key (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) is set** and the user selects it. Keep OCR the default; never make a vision path mandatory.
- **DB must work both locally and on Vercel free tier.** Keep the single `@libsql/client` abstraction in `src/lib/db.ts`: local SQLite file by default, Turso when `TURSO_DATABASE_URL` is set. Do not introduce a second DB library or a native better-sqlite3 build.
- **Multiple named portfolios** (`portfolio` + `portfolio_holding`). Each has its own saved holdings and uses the shared default model (`model_portfolio.is_active=1`) unless it has a custom model via `portfolio.model_id`. Holdings can now be saved per portfolio, but are still editable/re-imported each run.
- **Secrets stay server-side.** Vision keys (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`) are only read in server code (`vision.ts`, API routes); never send them to the client. `/api/config` exposes booleans + provider name only.

## Architecture map
- Pure business logic: `src/lib/rebalance.ts` (keep it pure & unit-tested).
- Image reading: `src/lib/ocr.ts` (+ `preprocess.ts`) for free OCR; `src/lib/vision.ts` for optional Claude Vision. Parsing: `src/lib/parse.ts` (OCR text, CSV, and `parseHoldingsHtml` for saved brokerage pages — the most accurate current-portfolio path). Symbol reconciliation + fuzzy snapping: `src/lib/symbols.ts`.
- Data access: `src/lib/repo.ts` over `src/lib/db.ts`.
- API: `src/app/api/{model,plan,prices,symbols,extract,config,portfolios,holdings}/route.ts` (all `runtime = "nodejs"`).
- UI: `src/app/page.tsx` orchestrates the engine toggle + `ModelSection`, `ActualSection`, `PlanSection`, `PortfolioBar`. Portfolio switch/load/create/rename/delete shows a loading banner and dims sections until ready (`LoadingIndicator`).

## Key domain facts
- The **model image uses full company names**; the **holdings image uses tickers**. `symbol_alias` + fuzzy snapping reconcile them. Seed list is in `src/lib/symbols.ts`.
- OCR mis-reads characters; `resolveSymbol` snaps garbled tokens to the nearest known ticker/name (conservatively — don't loosen tolerances without a test like the OGDC/DGKC case).
- A **CASH** line is part of the portfolio on both sides. Treat CASH specially (price = 1, residual buffer).
- PSX trades **whole shares** -> target units are always integers.
- A stock's value is ALWAYS quantity x price (only CASH carries an explicit value); `rebalance.ts` must never trust a stock `value` field, or price edits stop affecting the plan.
- Rebalance supports partial mode via `rebalanceSymbols` (only listed symbols trade; others HOLD).
- Portfolio **target size** (`portfolio.target_size`) derives cash and drives `%` columns; logic in `src/lib/portfolioValue.ts`.
- Live PSX price fetch (`src/lib/psx.ts`) is **best-effort and optional**; never let its failure break plan generation.

## When you change things
1. Update or add a vitest test in `__tests__/` for any change to `rebalance.ts`, `parse.ts`, `symbols.ts`, or `vision.ts`.
2. Run `npm test` and `npm run build` before declaring done.
3. If you change the DB schema, update both `src/lib/db.ts` (SCHEMA) and the data-model section of `README.md`.
4. Record notable decisions as a new `docs/ADR-000X-*.md`.

## Conventions
- TypeScript strict mode. No `any` in new code where avoidable.
- Keep API responses shaped as `{ <payload> }` or `{ error }`.
- Money is PKR; format via `src/lib/format.ts`.
