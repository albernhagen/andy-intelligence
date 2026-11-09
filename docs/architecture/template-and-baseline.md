# andy-intelligence — Project template and baseline inventory

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 8. Project template (what each managed project gets)

```
AGENTS.md                         # rules for all agents (CLAUDE.md symlink)
docs/roadmap.md
docs/features.md                  # living catalog of shipped features (updated on merge)
docs/architecture/overview.md     # current HLD; C4 L1–L2 in Mermaid
docs/architecture/adr/NNNN-*.md   # MADR, immutable
docs/agent/*.md                   # shared procedures: size-rubric, build, review, escalation, security
docs/product/brief.md             # project brief (ADR-0053) + further product docs
docs/security/threat-model.md     # living threat model + open risks (§9.1)
specs/NNN-name/{design.md, tech-design.md, tasks.md, stories/*.md, mockups/}
.github/workflows/                # thin callers → platform composite actions, pinned by SHA (ADR-0038)
.andy/baseline.json               # baseline version (andy-intelligence commit) this repo is on
CODEOWNERS                        # `*` requests Andy's review (ADR-0042); further lines = always-gated paths
infra/                            # Terraform: dev/prod Cloud Run, Cloud Deploy pipeline, read-only agent SAs
```
**Required CI checks** on `main`: tests, lint, typecheck, protected-path check, secret scan, security scans and security-review agent (§9.1), "PR references a ticket" (ticket key in branch name or PR body, verified against the control-plane API). These enforce rules for every agent regardless of harness.

Onboarding a project = UI/MCP "Add project" → onboarding interview → brief PR (ADR-0053) → bootstrap (applies the project baseline, §8.1; until then `platform/baseline/baseline.mjs onboard`, runbook `docs/runbooks/onboard-a-repo.md`: branch ruleset, repo settings, labels, template files, secrets refs, App install check, Terraform PR for GCP) → Andy approves Terraform PR.

### 8.1 Project baseline (ADR-0031)

Every guardrail built in this repo is packaged so each managed project gets it the same way, and this repo is configured from the same baseline. Built in M1.16: Project baseline v1. **Every slice that adds or changes a guardrail updates this table in the same PR.**

Carried by (ADR-0038): **A** = composite action in `platform/actions/`; managed repos get this repo's caller workflow with the action pinned to a commit SHA · **M** = managed file (kept identical; listed in `platform/baseline/manifest.json`) · **S** = seed file, copied once from `template/` · **G** = GitHub config in `platform/baseline/github/`, applied by `platform/baseline/baseline.mjs` · **TF** = Terraform module in `infra/modules/` · **RB** = runbook step (secrets).

Third-party action pins inside `platform/actions/` are bumped by this repo's Dependabot (`/platform/actions/*`); managed repos get them through the baseline pin. Drift: `baseline.mjs check <repo>` (Andy, local, everything); the weekly system security review checks labels and ruleset (its token can't read the rest).

| Guardrail | ADR | Source in this repo | Carried by | Status |
|---|---|---|---|---|
| Lint, typecheck, test, build | 0022 | `ci.yml` (`check`) → `platform/actions/ci-check` | A | carried (M1.16) |
| Firestore adapter contract suites on the emulator (path-gated) | 0034, 0048 | `firestore-suite.yml` | — | control plane only (no managed project has Firestore adapters yet) |
| Workflow linter (actionlint) | 0027 | `ci.yml` → `platform/actions/actionlint` | A | carried (M1.16) |
| Terraform fmt/validate | 0011, 0024 | `ci.yml` → `platform/actions/terraform-check` (skips without `infra/`) | A | carried (M1.16) |
| Public-safe Terraform plan summary | 0011 | `terraform-plan.yml` | — | not yet carried (M6: Dev → prod releases; needs per-project WIF) |
| Secret scan (TruffleHog) | 0015 | `secret-scan.yml` → `platform/actions/secret-scan` | A | carried (M1.16) |
| CodeQL, dependency review, Terraform misconfig scan | 0025, 0030 | `security-scans.yml` → `platform/actions/{codeql,dependency-review,terraform-misconfig}` | A | carried (M1.16) |
| Security-review agent + gate | 0025, 0030, 0037 | `security-review.yml`, `platform/actions/agent-review-*`, `scripts/review-*.mjs`, `platform/procedures/security-review.md` | A | carried (M1.16); procedure read from the pinned commit |
| Adversarial PR review | 0026, 0037 | `adversarial-review.yml`, `platform/actions/agent-review-*`, `scripts/review-gate.mjs`, `platform/procedures/adversarial-review.md` | A | carried (M1.16); procedure read from the pinned commit |
| System security review + drift | 0025, 0030 | `system-security-review.yml`, `platform/procedures/threat-model.md` | — | not yet carried (M6: Dev → prod releases; its drift plan is GCP-specific). Baseline drift for this repo added (M1.16) |
| Local hooks (lefthook) + Claude Code format hook + Prettier config | 0027 | `lefthook.yml`, `.claude/settings.json`, `scripts/format-edited-file.mjs`, `.prettierrc.json` | M | carried (M1.16) |
| Dependabot (npm, Actions; cooldown) | 0025, 0030 | `template/.github/dependabot.yml` (this repo's adds Terraform) | M | carried (M1.16) |
| PR template (docs + security checklist) | 0022, 0025 | `template/.github/pull_request_template.md` | M | carried (M1.16) |
| Agent rules; docs ship with the change | 0022 | `template/AGENTS.md.template` | S | carried (M1.16) |
| Threat model seed | 0025 | `template/docs/security/threat-model.md` | S | carried (M1.16) |
| Public-repo hygiene (`.gitignore`: tfvars, state, `.env*`) | 0015 | `template/gitignore.lines` | M (lines) | carried (M1.16) |
| `main` ruleset: PR required (squash), no force push/deletion, required checks, code scanning (CodeQL, high or higher) | 0025 | `github/ruleset-main.json` | G | carried (M1.16) |
| Merge settings: squash only, delete branch on merge, auto-merge allowed (Dependabot, ADR-0042; agent PRs through the review gate from M1.8: Build + gate, ADR-0050) | 0022, 0042, 0050 | `github/repo.json` | G | carried (M1.16; auto-merge from ADR-0042) |
| Agent PR policy `autoMerge` (`none` / `s` / `s-and-m` / `all`; new projects `s-and-m`, project AI `none`): merges only when required and review checks pass and no veto applies | 0050 | built (M1.8b): product setting, nothing to copy. Protected paths (`packages/domain/src/gate.ts`) apply to every project, plus CODEOWNERS paths after `*` from the base branch |
| `planApproval` (`none` / `m-and-l` / `all`): approved read-only plan before the build | 0050 | built (M1.8a): product setting, nothing to copy |
| Dependabot auto-merge: npm patches + stable minors after all required checks; bot merges don't deploy | 0042 | `dependabot-auto-merge.yml` → `platform/actions/dependabot-auto-merge`, `scripts/dependabot-merge.mjs` | A | carried (next baseline tag) |
| CODEOWNERS: Andy requested on every PR (incl. Dependabot) | 0042 | `template/.github/CODEOWNERS` | S | carried (next baseline tag) |
| Security & analysis: Dependabot alerts + security updates, secret scanning, push protection, private vulnerability reporting; CodeQL default setup off | 0015, 0025 | `github/security.json` (dependency graph is always on for public repos) | G | carried (M1.16) |
| Actions: read-only default token; Actions may open PRs; actions must be pinned to a full SHA | 0025, 0038 | `github/actions.json` | G | carried (M1.16) |
| Labels `security-accepted`, `review-accepted` | 0025, 0026 | `github/labels.json` | G | carried (M1.16) |
| Reviewer token secret | 0030 | `CLAUDE_CODE_OAUTH_TOKEN` | RB | carried (M1.16: `docs/runbooks/onboard-a-repo.md`) |
| GCP budget + alerts | 0028, 0029 | `infra/billing` | TF | not yet carried (M6: Dev → prod releases) |
| Cloud Run caps, log exclusions, usage alerts | 0028 | `infra/control-plane` | TF | not yet carried (M6: Dev → prod releases) |
| Cost kill switch (opt-in) | 0028, 0036 | `infra/billing/kill-switch.tf` + workflow YAML | TF | not yet carried (M6: Dev → prod releases) |
| Daily Firestore backup (7-day retention) | 0028 | `infra/control-plane` | TF | not yet carried (M6: Dev → prod releases) |
| Cloud Tasks queue caps (rate, concurrency, retries) | 0028 | `infra/control-plane` | TF | not yet carried (M6: Dev → prod releases) |
| Safe deploy: no-traffic revision, smoke test, then traffic | 0076 | `platform/actions/cloud-run-safe-deploy` | A | control plane only until M6: Dev → prod releases |
| UI screenshot checks (Playwright): a diff fails, actual images uploaded; 10-minute cap | 0045, 0059 | `ui-screenshots.yml` → `platform/actions/ui-screenshots`; config and images in `apps/web/e2e/` | — | control plane only; a managed project with a web UI can call the action (needs `playwright.config.ts`). Not a required check yet (Andy decides) |
| API request body cap (256 KB) | 0028 | `apps/api/src/app.ts` | — | control plane only (product apps choose their own) |
| Context budget: agent-loaded docs within size budgets (`context-budget.json`; default `AGENTS.md`/`CLAUDE.md` ≤ 200 lines) | 0046 | `scripts/context-budget.mjs` in `platform/actions/ci-check` | A | carried (next baseline tag) |
| Review agents: lockfiles out of the diff (code first, 120 KB cap with truncation note); lockfile sources must be the npm registry with integrity | 0046 | `platform/actions/agent-review-prepare`; `scripts/lockfile-sources.mjs` in `platform/actions/ci-check` | A | carried (next baseline tag) |
| Agent evals (`agent-evals` check) | 0040 | planned: M1.17: Agent evals v1 | A | not built |
| Executor permission profile (headless Claude Code) | 0040, 0051 | `platform/executor/profile.json` + `scripts/executor-profile.mjs`, installed by the reusable `claude-executor.yml` | — | built (M1.6a); managed repos call the reusable workflow from M5: Multi-project in parallel |
| Build runs: `autoBuild` switch (default off); `planApproval` (default none): an approved read-only plan first, owner-only decision, ≤ 3 plan runs, stale after a ticket or policy change or 72 h; Bash only in the sandbox (registry-only network, credentials unset and scrubbed), live-checked by one sandboxed Bash call before the agent (Haiku, 3 turns); `.git` paths that steer git checked and `.git` restored after it; sandbox placeholders dropped; publish job refuses protected paths, symlinks, > 200 files or > 5 MB; one App token per build run; ≤ 4 builds per ticket, dispatch paused at 3 tickets awaiting review | 0028, 0063, 0071 | `packages/domain/src/build{s,-dispatch}.ts`, `profile.json` `steps.build`, `claude-executor.yml` (`publish`), `scripts/executor-{publish,sandbox}.mjs`, `apps/api/src/github/token.ts`, `packages/domain/src/plans.ts` | — | built (M1.8a); managed repos with the reusable workflow (M5) |
| Webhook caps (1 MB body, 300 signed deliveries/minute per instance) + HMAC + 30-day TTL on records | 0028, 0041 | `apps/api/src/webhooks.ts`, `infra/control-plane` | — | control plane only (managed repos send webhooks; they don't receive them) |
| Bot-opened PRs run their checks (repo token from the control plane via Actions OIDC; agent job holds no write credential) | 0041, 0043 | `system-security-review.yml` (`publish` job), `apps/api/src/github/token.ts` | — | not yet carried (the system review itself isn't carried until M6: Dev → prod releases) |
| Sandbox self-test on executor changes | 0071 | `platform/actions/sandbox-self-test` | A | platform only; a project hosting an executor pins the action |
