# andy-intelligence — §8.1 baseline: GitHub settings rows

Rows moved unchanged from the §8.1 table in [template-and-baseline.md](template-and-baseline.md) (AI-221).

| Guardrail | ADR | Source in this repo | Carried by | Status |
|---|---|---|---|---|
| `main` ruleset: PR required (squash), no force push/deletion, required checks (branches need not be up to date: ADR-0144), code scanning (CodeQL, high or higher) | 0025, 0144 | `github/ruleset-main.json` | G | carried (M1.16), minus `github/source-only.json` (`firestore-suite`, `release-note`, `ui-screenshots`, `sandbox-self-test`, `agent-evals`, `agent-evals-plumbing`: jobs managed repos don't have). No per-project extra checks yet (`apply` replaces the ruleset) |
| Merge settings: squash only, delete branch on merge, auto-merge allowed (Dependabot; agent PRs through the review gate) | 0022, 0042, 0050 | `github/repo.json` | G | carried (M1.16; auto-merge from ADR-0042) |
| Merge mode `mergeMode` (`manual` / `epic` / `low-risk` / `all-clean`; new projects `low-risk`; unset merges nothing): the gate merges only on `mergeVerdict` (AI-215) | 0124, 0134 | built (M1.8b): product setting, nothing to copy. Protected paths (`packages/domain/src/gate.ts`) apply to every project, plus CODEOWNERS paths from the base branch |
| `planApproval` (`none` / `m-and-l` / `all`): approved read-only plan before the build | 0050 | built (M1.8a): product setting, nothing to copy |
| Dependabot auto-merge: npm patches + stable minors after required checks; bot merges don't deploy | 0042 | `dependabot-auto-merge.yml` → `platform/actions/dependabot-auto-merge`, `scripts/dependabot-merge.mjs` | A | carried (next baseline tag) |
| CODEOWNERS: the kept paths only, no `*` line (`KEPT_PATHS`; a test keeps both copies equal); `protect-main` sets code-owner review at 0 approvals (repo-admin role bypasses on PRs, the App never), which GitHub did not enforce on a PR authored by the only code owner (AI-380, R23); the gate and `merge_pr` refuse kept paths in code | 0042, 0124 | `template/.github/CODEOWNERS`, `github/ruleset-main.json` | S, G | carried (next baseline tag; seeded once, so a repo seeded earlier needs its file replaced by hand) |
| Security & analysis: Dependabot alerts + security updates, secret scanning, push protection, private vulnerability reporting; CodeQL default setup off | 0015, 0025 | `github/security.json` (dependency graph: always on for public repos) | G | carried (M1.16) |
| Actions: read-only default token; Actions may open PRs; actions must be pinned to a full SHA | 0025, 0038 | `github/actions.json` | G | carried (M1.16) |
| Labels `security-accepted`, `review-accepted` | 0025, 0026 | `github/labels.json` | G | carried (M1.16) |
