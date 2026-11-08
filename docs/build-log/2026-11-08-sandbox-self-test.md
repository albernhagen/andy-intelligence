# 2026-11-08 — CI self-test of the build sandbox (AI-63)

`sandbox-self-test` runs the test bed (`scripts/sandbox-lab/`) on the runner when a PR changes an executor path, and passes without running otherwise.

- **No model, real sandbox:** `stub-model.mjs` stands in for the Messages API and always makes the one Bash call, so the real Claude Code and its sandbox run with only fake credentials.
- **Same check:** the check command is read from `claude-executor.yml` and judged by `executor-sandbox.mjs verify-check`, then `probe.sh` gathers the §9 facts and `expectations.mjs` asserts them.
- **Gate:** the whole PR's diff (merge commit against its base), so a later doc-only push can't skip the test. That means proving the skip needed a doc-only PR based on this branch, closed unmerged.
- **Required check:** Andy adds `sandbox-self-test` to the `protect-main` ruleset once the job is proven.
