# andy-intelligence — §8.1 baseline: GitHub settings rows

Rows moved unchanged from the §8.1 table in [template-and-baseline.md](template-and-baseline.md) (AI-221).

| Guardrail | ADR | Source in this repo | Carried by | Status |
|---|---|---|---|---|
| `main` ruleset: PR required (squash), no force push/deletion, required checks on a head up to date with `main` (AI-284), code scanning (CodeQL, high or higher) | 0025 | `github/ruleset-main.json` | G | carried (M1.16), minus `github/source-only.json` (`firestore-suite`). No per-project extra checks yet (`apply` replaces the ruleset) |
| Merge settings: squash only, delete branch on merge, auto-merge allowed (Dependabot; agent PRs through the review gate) | 0022, 0042, 0050 | `github/repo.json` | G | carried (M1.16; auto-merge from ADR-0042) |
| Agent PR policy `autoMerge` (`none` / `s` / `s-and-m` / `all`; new projects `s-and-m`, project AI `none`): merges only when required and review checks pass and no veto applies | 0050 | built (M1.8b): product setting, nothing to copy. Protected paths (`packages/domain/src/gate.ts`) apply to every project, plus CODEOWNERS paths after `*` from the base branch |
| `planApproval` (`none` / `m-and-l` / `all`): approved read-only plan before the build | 0050 | built (M1.8a): product setting, nothing to copy |
| Dependabot auto-merge: npm patches + stable minors after required checks; bot merges don't deploy | 0042 | `dependabot-auto-merge.yml` → `platform/actions/dependabot-auto-merge`, `scripts/dependabot-merge.mjs` | A | carried (next baseline tag) |
| CODEOWNERS: Andy requested on every PR (incl. Dependabot) | 0042 | `template/.github/CODEOWNERS` | S | carried (next baseline tag) |
| Security & analysis: Dependabot alerts + security updates, secret scanning, push protection, private vulnerability reporting; CodeQL default setup off | 0015, 0025 | `github/security.json` (dependency graph: always on for public repos) | G | carried (M1.16) |
| Actions: read-only default token; Actions may open PRs; actions must be pinned to a full SHA | 0025, 0038 | `github/actions.json` | G | carried (M1.16) |
| Labels `security-accepted`, `review-accepted` | 0025, 0026 | `github/labels.json` | G | carried (M1.16) |
