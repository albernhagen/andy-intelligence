# 2026-11-04 — Dispatch run ID fix (AI-1: M1.6a: Claude Code executor)

- First live start after PR #51 failed: `couldn't start the run: GitHub did not return the dispatched run's ID`. GitHub returns the run's ID only when the dispatch sets `return_run_details: true` (changelog 2026-02-19); without it, `204` and no body. The adapter didn't send it, and the test's fake GitHub returned an ID regardless.
- The workflow had started anyway (Actions run 41759609520). The control plane had already failed the Run, so its context call was refused and it stopped in the first job: no agent ran, no Claude quota used.
- Fix: send `return_run_details: true`; the fake GitHub now returns `204` without it, like GitHub.
- The App's Actions write permission (runbook `agent-runs.md` §1) is confirmed: GitHub accepted the dispatch.
