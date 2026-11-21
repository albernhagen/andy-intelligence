# 2026-11-21 — AI-257: M10.9: Spend panel and cap alerts

Read-only panel and pure notice rules for M10: Paid models + spend caps. Nothing spends money, and nothing sends the notices yet: the spend gate (AI-248: M10.7) knows when a scope stops and will call the rule.

- **Panel** (`apps/web/src/components/spend/SpendPanel.tsx`, one mount line on Dashboards, after DORA): per project and for all projects, today and this month against the caps in force, from AI-249's `GET /api/projects/{projectId}/spend`. The all-projects view reads at most 20 projects (ADR-0028). Unknown spend shows as "unknown". No new route.
- **Notices** (`packages/domain/src/spend-notices.ts`, `spendNotices`): a scope at 80% of a daily or monthly cap (project or global), and a scope stopped at a cap naming up to 5 waiting ticket keys. Deduplicated by cap, scope and UTC window (global caps once, whichever project reaches them); at most 10 a UTC day; old windows pruned from the kept state. Numbers, keys and fixed phrases only: anything that isn't a ticket key is dropped, so no agent text reaches a notice. A zero cap (paid off) and unknown spend never warn.
- **Not built (ticket asked):** spend by provider, and settled vs reserved. `SpendLedger.totals` keeps one total per project or global scope and window, so a provider split needs per-provider totals in the port and the Firestore adapter: a follow-up.
- Tests: 13 for the notices, 9 for the panel (including no projects, and one project whose read fails while the others still show).
