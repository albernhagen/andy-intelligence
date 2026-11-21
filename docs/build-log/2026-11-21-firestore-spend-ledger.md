# 2026-11-21 — AI-247: M10.6: Firestore spend ledger

The Firestore adapter for the `SpendLedger` port from AI-234: M10.2 (M10: Paid models + spend caps). Nothing calls it yet (M10.7: Spend gate at dispatch).

- `packages/store/src/spend-ledger.ts` (`FirestoreSpendLedger`), one sorted export block in the store index.
- **Collections**, server-only (the rules already deny every client read and write): `spend/{sha256(id)}` for entries; `spendTotals/{scope}|{window}` for running totals, one document per scope (`global`, `project:<id>`) and UTC window (`day:YYYY-MM-DD`, `month:YYYY-MM`). New collections only: no migration, no rules change, no `SCHEMA_VERSION` bump, no index (no queries).
- **Atomic:** `reserve` reads the entry and its four totals, checks `spendCapPassed`, then writes the entry and the four totals in one transaction, or nothing. `settle` and `release` move the entry and adjust the same four totals by the difference, also in one transaction.
- **Bounded reads (ADR-0126):** a reserve, settle or release reads five documents; `totals` reads two. Nothing scans entries.
- **Fails closed:** a missing total document is zero (no spend yet); a total that can't be read or doesn't parse fails the call, so nothing is recorded.
- Passes the shared 21-case contract suite on the emulator, including two reservations racing for the last room under a cap and the retry-with-other-terms conflict.
