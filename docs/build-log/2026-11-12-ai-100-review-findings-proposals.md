# 2026-11-12 — AI-100: review findings → pending config changes, PR A

- AI-100's first step found that review findings aren't stored: they live only in the sticky PR comments `scripts/review-gate.mjs` writes; `RunMetrics.reviewFailures` keeps failed check names. The ticket said to stop and ask.
- Coordinator's decision: two PRs (ADR-0097). PR A (this one, medium): `ReviewFindingSource` and `ConfigChangeStore` ports, fakes, contract suites, the Firestore store, the grouping rule, and `/api` routes to sweep, list and reject. PR B (high, Andy): the review workflow posts findings over the Actions OIDC callback, a `kind` field, the findings adapter.
- Until PR B the source returns nothing, so a sweep proposes nothing; `docs/features.md` and README get their rows with PR B.
