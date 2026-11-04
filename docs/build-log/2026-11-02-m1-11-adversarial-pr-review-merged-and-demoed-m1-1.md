# 2026-11-02 — M1.11: Adversarial PR review merged and demoed; M1.16: Project baseline v1 started

- Merged: PR #21: Adversarial PR review. (PR #20: kill switch plan fix was applied and demoed before it merged; see 2026-11-01.)
- Demo (PR #22, closed): a planted off-by-one got a `blocker` with a failing scenario (≈ $0.05 API-equivalent). The fix push re-reviewed incrementally (`incremental review since <sha>`) and listed both findings under Resolved. A second planted bug got 2 blockers; `review-accepted` passed the check in ≈ 10 s without running the agent; a new push removed the label and the check failed again. M1.11: Adversarial PR review Done when met.
- Andy created the `review-accepted` label and added `adversarial-review` to the required checks in `protect-main`.
- Branch `m1.16/project-baseline` started.
