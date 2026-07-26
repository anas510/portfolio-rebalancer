# .agents — working agreement for AI agents

This directory documents how automated agents should contribute to the PSX Portfolio
Rebalancer. Read `../.claude/CLAUDE.md` first for project memory; this file adds conventions
and a task playbook.

## Golden rules
1. **Never delete files without explicit user confirmation.**
2. **Keep it free.** No paid APIs, no cloud services required to run locally. OCR stays in the browser.
3. **One DB abstraction.** All persistence goes through `src/lib/repo.ts` → `src/lib/db.ts` (libsql). Never add a second DB driver.
4. **Pure core.** `src/lib/rebalance.ts` must remain free of I/O so it stays unit-testable.
5. **Verify before finishing.** `npm test` and `npm run build` must pass.

## Definition of done
- [ ] Types updated in `src/lib/types.ts` if the data shape changed.
- [ ] Unit test added/updated for logic changes (`__tests__/`).
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] README and/or an ADR updated for user-facing or architectural changes.

## Common tasks

### Add a new stock mapping
Edit `SEED_ALIASES` in `src/lib/symbols.ts` **and** add a runtime alias via `POST /api/symbols`
(so existing databases pick it up without a reseed).

### Change rebalancing behaviour (lot sizes, rounding, cash rules)
Edit `src/lib/rebalance.ts` only. Add a test in `__tests__/rebalance.test.ts` covering the new
behaviour with a realistic PSX example.

### Improve parsing accuracy
Edit `src/lib/parse.ts`. Prefer widening the tolerant regex/heuristics over adding dependencies.
Add fixtures + tests using real OCR text samples.

### Swap OCR for a paid vision model (only if the user asks)
Replace `src/lib/ocr.ts` implementation; keep the `ocrImage()` signature and the `parse.ts`
structuring layer intact. Gate any key behind an env var and fall back to tesseract when absent.

## Files an agent should not touch casually
- `src/lib/db.ts` connection logic (breaks Vercel/Turso parity).
- The `runtime = "nodejs"` exports in API routes (libsql needs Node, not Edge).
