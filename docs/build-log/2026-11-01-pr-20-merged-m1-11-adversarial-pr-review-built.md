# 2026-11-01 — PR #20 merged; M1.11: Adversarial PR review built

- Merged: PR #20: kill switch plan fix (applied and demoed first).
- **Decided (Andy, ADR-0037: Review agents share composite actions; adversarial re-reviews are incremental):** blockers clear by re-review with replies as context; shared plumbing; Sonnet, 40 turns, docs-only skip; quota kept low with incremental re-reviews. Composite actions instead of a reusable workflow, because a reusable workflow renames the required `security-review` check.
- Branch `m1.11/adversarial-review`: `adversarial-review.yml`, `.github/actions/agent-review-{prepare,finish}`, `scripts/review-gate.mjs` (replaces `security-review-gate.mjs`; scope script renamed to `review-scope.mjs`), procedure + schema, `security-review.yml` moved onto the shared actions, runbook `docs/runbooks/adversarial-review.md`.
- Verified locally: gate tests (38 in `scripts`), actionlint clean. Not verifiable locally: the agents (this PR's own checks run both), the demo (after merge).
