# 2026-11-20 — AI-234: M10.2: Spend ledger port and fake

First M10: Paid models + spend caps slice. Contracts only: nothing calls the ledger and nothing spends money.

- `packages/contracts/src/{entities,ports,fakes,testing}/spend.ts`, one sorted `export *` line in each folder's `index.ts` (ADR-0110).
- **Money:** integer micro-dollars (`MicroUsd`, 1 USD = 1,000,000), never floats, so totals add exactly.
- **`SpendLedger`:** `reserve(entry, caps)` records a `reserved` entry unless it would pass a cap, and then records nothing and returns which cap, the limit and what was used. Order: per task, project daily, project monthly, global daily, global monthly (`spendCapPassed`, shared by every adapter). A retried id comes back counted once. `settle(id, microUsd | null, at)` counts the actual cost, or the full reservation when the cost is unknown; `release` counts nothing; both are idempotent. `totals({ projectId? }, at)` gives the UTC day and month an entry was reserved in.
- **Append-only:** no delete; an entry only moves from `reserved` to `settled` or `released`.
- **Caps** arrive as plain numbers (null: none at that level), so this slice doesn't wait on M10.3. Failing closed on unknown caps is M10.7's job.
- **Suite:** 17 cases, including two reservations racing for the last room under a cap (at most one recorded). M10.6's Firestore adapter must pass the same suite.
