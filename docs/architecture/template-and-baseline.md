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
specs/NNN-name/{design.md, tech-design.md, tasks.md, tickets/*.md, mockups/}
.github/workflows/                # thin callers → platform composite actions, pinned by SHA (ADR-0038)
.andy/baseline.json               # baseline version (andy-intelligence commit) this repo is on
CODEOWNERS                        # kept paths only (ADR-0124): code-owner review set, not enforced (AI-380); no `*` line
infra/                            # Terraform per deploy kind (`cloud-run`: Cloud Run, deployers, read-only agent SAs; ADR-0114)
```
**Required CI checks** on `main`: tests, lint, typecheck, protected-path check, secret scan, security scans and security-review agent (§9.1), "PR references a ticket" (ticket key in branch name or PR body, verified against the control-plane API).

Onboarding a project = optional discovery in Andy's session (`/discover`, ADR-0145) → UI/MCP "Add project" → each repo gets a baseline PR from the App (ADR-0142; runbook `onboard-a-repo.md`) → onboarding interview → brief PR (ADR-0053) → Andy approves Terraform PR.

### 8.1 Project baseline (ADR-0031)

Every guardrail built here reaches each managed project the same way, this repo included; a ticket that adds or changes one updates this table.

Carried by (ADR-0038): **A** = composite action in `platform/actions/`; managed repos get the caller workflow with the action pinned by SHA · **M** = managed file (kept identical; listed in `platform/baseline/manifest.json`) · **S** = seed file, copied once from `template/` · **G** = GitHub config in `platform/baseline/github/`, applied by `platform/baseline/baseline.mjs` · **TF** = Terraform module in `infra/modules/` · **RB** = runbook step (secrets).

This repo's Dependabot bumps third-party pins in `platform/actions/`; managed repos get them through the baseline pin. Drift: `baseline.mjs check <repo>`; the weekly system review checks labels and ruleset.

GitHub settings rows (ruleset, merge settings, `autoMerge`, `planApproval`, Dependabot auto-merge, CODEOWNERS, security and analysis, Actions, labels): [`baseline-github-settings.md`](baseline-github-settings.md).

Build runs (plan approval, sandbox, publish limits) and read caps (AI-222): [`baseline-build-and-reads.md`](baseline-build-and-reads.md).

| Guardrail | ADR | Source in this repo | Carried by | Status |
|---|---|---|---|---|
| Lint, typecheck, test, build | 0022 | `ci.yml` (`check`) → `platform/actions/ci-check` | A | carried (M1.16) |
| Firestore adapter contract suites on the emulator (path-gated) | 0034, 0048 | `firestore-suite.yml` | — | control plane only (`github/source-only.json`) |
| Workflow linter (actionlint) | 0027 | `ci.yml` → `platform/actions/actionlint` | A | carried (M1.16) |
| Terraform fmt/validate; `terraform test` (mocked) in roots with `tests/` | 0011, 0024 | `ci.yml` → `platform/actions/terraform-check` | A | carried (M1.16; tests: next baseline tag) |
| Public-safe Terraform plan summary | 0011 | `terraform-plan.yml` | — | not yet carried (M6: Dev → prod releases; needs per-project WIF) |
| Secret scan (TruffleHog) | 0015 | `secret-scan.yml` → `platform/actions/secret-scan` | A | carried (M1.16) |
| CodeQL, dependency review, Terraform misconfig scan | 0025, 0030 | `security-scans.yml` → `platform/actions/{codeql,dependency-review,terraform-misconfig}` | A | carried (M1.16) |
| Security-review agent + gate | 0025, 0030, 0037 | `security-review.yml`, `platform/actions/agent-review-*`, `scripts/review-*.mjs`, `platform/procedures/security-review.md` | A | carried (M1.16); procedure read from the pinned commit |
| Adversarial PR review | 0026, 0037 | `adversarial-review.yml`, `platform/actions/agent-review-*`, `scripts/review-gate.mjs`, `platform/procedures/adversarial-review.md` | A | carried (M1.16); procedure read from the pinned commit |
| "Not reviewed" fails the review check; a re-sync merge carries the verdict when the PR's diff is unchanged | 0140, 0141 | `platform/actions/agent-review-*` (`resync-bot`, `agent-bot` inputs), `scripts/review-carry.mjs`, `scripts/review-gate.mjs` | A | built (AI-346); managed repos get it with the next baseline pin |
| System security review + drift | 0025, 0030 | `system-security-review.yml`, `platform/procedures/threat-model.md` | — | not yet carried (M6: Dev → prod releases; its drift plan is GCP-specific) |
| Lefthook (push: affected tests, ¼ of cores), format hook, Prettier | 0027, 0113 | `lefthook.yml`, `.claude/settings.json`, `scripts/format-edited-file.mjs`, `.prettierrc.json` | M | carried (M1.16) |
| Dependabot (npm, Actions; cooldown) | 0025, 0030 | `template/.github/dependabot.yml` (this repo's adds Terraform) | M | carried (M1.16) |
| PR release-note block; screenshot table (public repos; private: image source open) | 0121, 0153 | `release-note.yml` → `platform/actions/release-note-check` | A | not yet carried; required here only (`github/source-only.json`, AI-350) |
| PR template (docs + security checklist) | 0022, 0025 | `template/.github/pull_request_template.md` | M | carried (M1.16) |
| Agent rules; docs ship with the change | 0022 | `template/AGENTS.md.template` | S | carried (M1.16) |
| Threat model seed | 0025 | `template/docs/security/threat-model.md` | S | carried (M1.16) |
| Design file seed; UI tickets follow it (agent rule, build prompt) | 0045, 0132 | `template/design.md` | S | carried (AI-128) |
| Dispatch, sync, night and local-runner caps (2 runners, claim/10 s, lookup caps), pause, warn cap | 0079, 0083, 0094, 0049, 0100 | `dispatch-caps.ts`, `night-budget.ts`, `sync-runs.ts`, `runners.ts`, `local-claims.ts` | — | control plane |
| Merge queue caps: 20 PRs/repo, 3 syncs/PR, 60 min queued, 90 s lease | 0150 | `merge-queue.ts` | — | control plane |
| Spend gate (AI-248): a `pay_per_use` task reserves its per-task cap (`--max-budget-usd`, AI-260) before it starts; no price, unreadable caps or ledger, or a passed cap refuses it (`spend_cap`); a reservation is released or kept in full, never dropped | 0028 | `packages/domain/src/spend-gate.ts`, `runs.ts` | — | control plane |
| Night merges into `epic/<KEY>`: same gate (rules from the default branch), once per child ticket (claim before the merge call), ≤ 50 per launch; morning PR never auto-merges | 0049, 0107 | `night-merge.ts`, `gate-service.ts` | — | control plane |
| Public-repo hygiene (`.gitignore`: tfvars, state, `.env*`) | 0015 | `template/gitignore.lines` | M (lines) | carried (M1.16) |
| Reviewer token secret | 0030 | `CLAUDE_CODE_OAUTH_TOKEN` | RB | carried (M1.16: `docs/runbooks/onboard-a-repo.md`) |
| GCP budget + alerts | 0028, 0029, 0114 | `infra/modules/project-budget` via `infra/billing` `managed_projects` | TF | carried (TF): Andy adds an entry and applies (billing runbook §8) |
| Cloud Run caps, log exclusions, usage alerts, daily Firestore backup (7-day retention), Cloud Tasks queue caps (rate, concurrency, retries) | 0028 | `infra/control-plane` | TF | not yet carried (M6: Dev → prod releases) |
| Alert: config change not in the change log (AI-136); test keeps filter and message in step | — | `infra/control-plane`, `config-changes.test.ts` | TF | not yet carried (M6: Dev → prod releases) |
| Cost kill switch (opt-in) | 0028, 0036 | `infra/billing/kill-switch.tf`; `infra/modules/project-budget` (+ workflow YAML) | TF | carried (TF): per entry, off by default |
| Safe deploy: no-traffic revision, smoke test, then traffic | 0076, 0114 | `platform/actions/cloud-run-safe-deploy` | A | control plane only until M6: Dev → prod releases, then `cloud-run` projects |
| Release (promote by digest, rollback by pinned revision then `/health`): inputs and the digest or revision checked before traffic moves; one run per environment | 0114 | `release.yml` → `platform/actions/cloud-run-release-check`, `cloud-run-rollback`, `cloud-run-safe-deploy`; `scripts/cloud-run-release.mjs` | A | control plane only (rollback; prod-only) until AI-206: M6.17: Deploy caller in the baseline copies `release.yml` |
| UI screenshot checks (Playwright): a diff fails, actual images uploaded; 10-minute cap; skips docs-only PRs | 0045, 0059 | `ui-screenshots.yml` → `platform/actions/ui-screenshots`; config and images in `apps/web/e2e/` | — | control plane only; a managed web UI can call the action (needs `playwright.config.ts`; input `base-ref`). Required here only (`github/source-only.json`, AI-350) |
| Fonts served by the app: the web build fails if a built file names a font host or loads a font from another host | 0151 | `apps/web/scripts/check-fonts.ts` (run by `pnpm build`) | — | control plane only; a managed web UI can copy the script |
| Refine caps (questions, children); email (20/day, 10-min batch) | 0028, 0075 | `packages/domain/src/{refine-gate,notify-email}.ts` | — | control plane |
| Push caps (6/hour, 30/day, then one "more waiting" push per window); quiet hours; no agent text in pushes; 10 subscriptions per user | 0028, 0052 | `packages/domain/src/notify-push.ts`, `packages/store/src/push-subscription-store.ts` | — | control plane |
| Spend notices: 80% of a cap and a stop, once per cap and window, 10 a day, no agent text | 0028 | `packages/domain/src/spend-notices.ts` | — | control plane |
| Membership caps: 20 members per project, 100 in all, checked inside `put`'s transaction; member reads capped to match | 0028, 0126 | `packages/store/src/membership-store.ts` | — | control plane |
| API request body cap (256 KB); UI poll floor 5 s | 0028, 0091 | `apps/api/src/app.ts`, `apps/web/src/lib/live.ts` | — | control plane only |
| Context budgets, PR ≤ half room, judged on its own change; hard only on files every session or agent step loads, `"warn": true` entries never fail; over on `main` warns and keeps one trim issue (`context-budget.json`; default `AGENTS.md`/`CLAUDE.md` ≤ 200 lines) | 0046, 0106, 0138, 0147 | `scripts/context-budget.mjs` in `platform/actions/ci-check`; `context-budget-trim` job (`ci.yml`) | A | carried (next baseline tag) |
| Review agents: lockfiles out of the diff (code first, 120 KB cap with truncation note); lockfile sources must be the npm registry with integrity | 0046 | `platform/actions/agent-review-prepare`; `scripts/lockfile-sources.mjs` in `platform/actions/ci-check` | A | carried (next baseline tag) |
| Agent evals (`agent-evals` check); skips non-agent changes | 0040, 0086 | `platform/actions/agent-evals` | A | control plane only; `agent-evals` and `agent-evals-plumbing` required here only (`github/source-only.json`, AI-352) |
| Executor permission profile (headless Claude Code) | 0040, 0051 | `platform/executor/profile.json` + `scripts/executor-profile.mjs`, installed by the reusable `claude-executor.yml` | M (`agent-run.yml` caller) | built (M1.6a); managed repos get the caller from the baseline; its token sits in a `main`-only `agent` environment (AI-106) |
| Baseline PR on registration: missing files only, never workflows or settings, capped | 0142 | `github/registration.ts`, `baseline/plan.mjs` | — | control plane |
| Webhook caps (1 MB body, 300 signed deliveries/minute per instance) + HMAC + 30-day TTL on records | 0028, 0041 | `apps/api/src/webhooks.ts`, `infra/control-plane` | — | control plane only (managed repos only send webhooks) |
| Bot-opened PRs run their checks (repo token from the control plane via Actions OIDC; agent job holds no write credential) | 0041, 0043 | `system-security-review.yml` (`publish` job), `apps/api/src/github/token.ts` | — | not yet carried (until M6: Dev → prod releases) |
| Re-sync open PRs (clean merges only, capped; `no-auto-sync` label) | 0111 | `platform/actions/resync-prs` | A, G | label carried; caller needs per-project tokens |
| Sandbox self-test on executor changes | 0071 | `platform/actions/sandbox-self-test` | A | platform only; a project hosting an executor pins the action. Required here only (`github/source-only.json`, AI-352) |
