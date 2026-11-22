# 2026-11-21 — AI-346: review checks fail when not reviewed; re-sync merges carry the verdict

**What happened:** PR #343 (AI-321) showed it. The re-sync bot (ADR-0111) merged `main` into the PR, and both review agents refused the run because a bot started it. Both posted "not reviewed", and both checks passed. Re-running a job keeps the original actor, so only a person's push got a review.

**What changed (ADR-0139, proposed):**

- `scripts/review-gate.mjs`: new modes. `skipped` (docs-only, draft, Dependabot) passes. `unavailable` (no token, agent error or quota, invalid output) now fails unless the override label is on. `carried` passes when the previous verdict passed on the commit it names.
- `scripts/review-carry.mjs`: decides carry-forward for a push by the re-sync bot. The head must be a merge on the reviewed commit, of a commit on the base branch; the previous verdict must be ✅; and the PR's own diff must be unchanged (`git patch-id --verbatim`).
- `platform/actions/agent-review-{prepare,finish}`: a `resync-bot` input and a carry step. Both review workflows pass the App's login.
- Tests use a real repo with a bot-authored merge, including one that sneaks in a change and one that changes whitespace only.

**Why not `allowed_bots`:** it would spend quota on every re-sync and let a bot start agent runs that hold the Claude token. Carry-forward covers exactly the reviewed diff.
