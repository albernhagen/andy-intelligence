# 2026-11-21 — AI-280: M10: Spend ledger keeps totals per provider

Found while building AI-257: M10.9: Spend panel and cap alerts: the ledger kept per-project and global totals only, so nothing could show spend by provider.

- **Port:** `SpendLedger.totalsByProvider({ projectId? }, at)` returns one `ProviderSpendTotals` row per `ProviderKey` (declared order, zero when none) for the UTC day and month of `at`. Same counting as `totals`: reserved counts its reservation, settled its actual cost, released nothing.
- **Fake:** sums by provider. **Firestore:** four more running-total documents per entry, `{scope}|provider:<key>|{window}` for the project and global scopes and the day and month, read and written in the same transaction as the existing four (eight totals plus the entry). `totalsByProvider` reads two documents per provider (six today). No queries, no index, no rules change, no `SCHEMA_VERSION` bump.
- **No "unknown" row:** every entry has named its provider since AI-234 (`provider` is required), and nothing has written the ledger yet, so entries without a provider can't exist. A provider added to `ProviderKey` later gets its own row automatically.
- **Suite:** 25 cases (4 new: zero rows, the split by provider and scope, settle and release, concurrent reserves on different providers), on the fake and the emulator.
