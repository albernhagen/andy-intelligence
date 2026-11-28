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
| Lint, typecheck, test, build; parallel jobs (`part` input; tests in two vitest shards), required `check` passes only when every part succeeded | 0022 | `ci.yml` (`check-*` parts, `check` gate) → `platform/actions/ci-check`, `scripts/ci-check-result.mjs`, `scripts/test-files-check.mjs` (a sharded run fails when the whole suite has no test files) | A | carried (M1.16); parallel parts with the next baseline pin (AI-402) |
| Test coverage: floors per package in the vitest config (`coverage.thresholds`) fail `check`; job summary with a per-package table and the PR's changed-line coverage (warning under 80%, never fails) | — | `ci.yml` (`check-coverage` merges the shards' blob reports) → `platform/actions/ci-check` (`part: coverage`), `scripts/coverage-report.mjs`; floors: `vitest.config.ts`, `template/starter/vitest.config.ts` | A, starter | built (AI-407); managed repos get it with the next baseline pin; a repo with its own app adds `@vitest/coverage-v8` and floors, or `check` fails naming it |
| Firestore adapter contract suites on the emulator (path-gated) | 0034, 0048 | `firestore-suite.yml` | — | control plane only (`github/source-only.json`) |
| Workflow linter (actionlint) | 0027 | `ci.yml` → `platform/actions/actionlint` | A | carried (M1.16) |
| Terraform fmt/validate (roots, `infra/modules/` and their `examples/`, and `template/infra/` when present); `terraform test` (mocked) where there is `tests/` | 0011, 0024 | `ci.yml` → `platform/actions/terraform-check` | A | carried (M1.16; tests: next baseline tag) |
| Public-safe Terraform plan summary | 0011 | `terraform-plan.yml` | — | not yet carried (M6: Dev → prod releases; needs per-project WIF) |
| Secret scan (TruffleHog) | 0015 | `secret-scan.yml` → `platform/actions/secret-scan` | A | carried (M1.16) |
| CodeQL, dependency review, Terraform misconfig scan | 0025, 0030 | `security-scans.yml` → `platform/actions/{codeql,dependency-review,terraform-misconfig}` | A | carried (M1.16) |
| Security-review agent + gate | 0025, 0030, 0037 | `security-review.yml`, `platform/actions/agent-review-*`, `scripts/review-*.mjs`, `platform/procedures/security-review.md` | A | carried (M1.16); procedure read from the pinned commit |
| Adversarial PR review | 0026, 0037 | `adversarial-review.yml`, `platform/actions/agent-review-*`, `scripts/review-gate.mjs`, `platform/procedures/adversarial-review.md` | A | carried (M1.16); procedure read from the pinned commit |
| "Not reviewed" fails the review check; a re-sync merge carries the verdict when the PR's diff is unchanged | 0140, 0141 | `platform/actions/agent-review-*` (`resync-bot`, `agent-bot` inputs), `scripts/review-carry.mjs`, `scripts/review-gate.mjs` | A | built (AI-346); managed repos get it with the next baseline pin |
| Review agents skip a Dependabot minor or patch bump that changes only `package.json` dependency versions and `pnpm-lock.yaml` (no new package, no major, transitive included), outside `.github/`, `infra/`, `platform/`, `template/`; checks pass with the reason; deterministic scans still run | 0030, 0037 | `platform/actions/agent-review-prepare` → `scripts/review-scope.mjs --dependency-bump` | A | built (AI-394); managed repos get it with the next baseline pin |
| Playwright package and its browser image move together: own Dependabot PR; the screenshot job fails first, naming the fix, on a version mismatch | 0059 | `.github/dependabot.yml`, `template/.github/dependabot.yml` (`exclude-patterns`); `platform/actions/ui-screenshots` → `scripts/playwright-image.mjs` | M, A | built (AI-394); Dependabot rule carried with the next baseline; the check comes with the action |
| System security review + drift | 0025, 0030 | `system-security-review.yml`, `platform/procedures/threat-model.md` | — | not yet carried (M6: Dev → prod releases; its drift plan is GCP-specific) |
| Lefthook (push: affected tests, ¼ of cores), format hook, Prettier | 0027, 0113 | `lefthook.yml`, `.claude/settings.json`, `scripts/format-edited-file.mjs`, `.prettierrc.json` | M | carried (M1.16) |
| Dependabot (npm weekly, dev and prod groups; Actions monthly; cooldown) | 0025, 0030 | `template/.github/dependabot.yml` (`none`), `template/.github/dependabot.cloud-run.yml` (`cloud-run`: the same plus monthly Terraform for `infra/` and Docker for the seeded root `Dockerfile`, base-image majors by hand), one manifest entry per `deployKind`; this repo's adds Terraform (one PR per provider across roots) and Docker base images | M | carried (M1.16; AI-399: new projects in the baseline PR, existing ones with the next `files` run); Docker: AI-401 |
| PR release-note block; screenshot table (public repos; private: image source open) | 0121, 0153 | `release-note.yml` → `platform/actions/release-note-check` | A | not yet carried; required here only (`github/source-only.json`, AI-350) |
| PR template (docs + security checklist) | 0022, 0025 | `template/.github/pull_request_template.md` | M | carried (M1.16) |
| Agent rules; docs ship with the change | 0022 | `template/AGENTS.md.template` | S | carried (M1.16) |
| Threat model seed | 0025 | `template/docs/security/threat-model.md` | S | carried (M1.16) |
| Design file seed; UI tickets follow it (agent rule, build prompt) | 0045, 0132 | `template/design.md` | S | carried (AI-128) |
| Dispatch, sync, night and local-runner caps (2 runners, claim/10 s, lookup caps), pause, warn cap | 0079, 0083, 0094, 0049, 0100 | `dispatch-caps.ts`, `night-budget.ts`, `sync-runs.ts`, `runners.ts`, `local-claims.ts` | — | control plane |
| Merge queue caps: 20 PRs/repo, 3 syncs/PR, 60 min queued, 90 s lease | 0150 | `merge-queue.ts` | — | control plane |
| Verify task caps: one per deployment and per project in flight, 50 tickets, 30 turns, 20 min agent step / 25 min deadline, 3 tasks per ticket; WebFetch of the deployed host only | 0159 | `verify-dispatch.ts`, `runs.ts`, `profile.json` (`verify`) | `claude-executor.yml` (called by `agent-run.yml`) | control plane + executor |
| Merge button and `/github/pr-sync` caps: 30 merges/project/h (shared with `merge_pr`), 30 reads/min | 0157 | `merges.ts`, `github/pr-sync.ts` | — | control plane |
| Promote and rollback: owner only, one release request per project per minute (transaction), a report must match its request, queued run check | 0160 | `releases.ts`, `release-requests.ts` (domain), `release-request-store.ts` | — | control plane, for every `cloud-run` project |
| Merges hold while the default branch is red (`main_red`: a required check failed on its tip); one Needs-you note after 30 min held | 0154 | `merge-verdict.ts`, `merge-facts.ts`, `merge-queue.ts` | — | control plane (every repo with the App) |
| Spend gate (AI-248): a `pay_per_use` task reserves its per-task cap (`--max-budget-usd`, AI-260) before it starts; no price, unreadable caps or ledger, or a passed cap refuses it (`spend_cap`); a reservation is released or kept in full, never dropped | 0028 | `packages/domain/src/spend-gate.ts`, `runs.ts` | — | control plane |
| Night merges into `epic/<KEY>`: same gate (rules from the default branch), once per child ticket (claim before the merge call), ≤ 50 per launch; morning PR never auto-merges | 0049, 0107 | `night-merge.ts`, `gate-service.ts` | — | control plane |
| Public-repo hygiene (`.gitignore`: tfvars, state, `.env*`) | 0015 | `template/gitignore.lines` | M (lines) | carried (M1.16) |
| Reviewer token secret | 0030 | `CLAUDE_CODE_OAUTH_TOKEN` | RB | carried (M1.16: `docs/runbooks/onboard-a-repo.md`) |
| GCP budget + alerts | 0028, 0029, 0114 | `infra/modules/project-budget` via the seeded template root (`template/infra/cloud-run/`), else `infra/billing` `managed_projects` | TF, S | carried (TF): a `cloud-run` project's baseline PR seeds one budget per environment (AI-109: M6.22); others: Andy adds an entry (billing runbook §8); Andy applies |
| Deploy scaffold: Terraform root per deploy kind and environment policy (`project-env` + `project-budget` per environment, modules pinned by SHA, example values only, plan test, `repo_variables` output) | 0028, 0038, 0114 | `template/infra/cloud-run/{prod-only,dev-and-prod}/` → `infra/`; `.terraform-version` | S | carried (S): `cloud-run` projects' baseline PR (AI-109: M6.22); planned in CI by `terraform-check`; Andy applies (runbook `project-env.md`) |
| Starter `Dockerfile` and `.dockerignore` (one seed group): base image pinned `tag@sha256` (multi-arch index), non-root `node` user, serves `dist/main.js` on `$PORT` (8080) with `/health`; starter app gets `src/server.ts`, `src/main.ts` | 0114 | `template/docker/` → repo root; `template/starter/src/{server,main}.ts` (starter, `cloud-run` only) | S | carried (S): `cloud-run` projects' baseline PR (AI-401); never rewritten once there; this repo's Dependabot keeps the template's digest fresh (`/template/docker`) |
| Cloud Run caps (scale to zero, max instances, concurrency, timeout), log exclusions, usage alerts | 0028, 0114 | `infra/control-plane`; `infra/modules/project-env` | TF | carried (TF): `cloud-run` projects, one call per environment; Andy applies (runbook `project-env.md`) |
| Prod uptime check on `/health` (5 min, 3 regions: fixed cost cap) and 5xx alert (threshold ≤ 1000/5 min) | 0028, 0114 | `infra/modules/project-alerts`, called by `project-env` (`prod_alerts_enabled`; off for dev) | TF | carried (TF): `cloud-run` projects' prod environment (AI-209: M6.19); Andy applies (runbook `project-env.md`) |
| Deployers over WIF (main: `deploy.yml`/`release.yml` on `main` only; preview: same-repo PRs, preview service only); per-service runtime identities | 0114 | `infra/modules/project-env` | TF | carried (TF): `cloud-run` projects |
| Daily Firestore backup (7-day retention), Cloud Tasks queue caps (rate, concurrency, retries) | 0028 | `infra/control-plane` | TF | not yet carried (M6: Dev → prod releases) |
| Alert: config change not in the change log (AI-136); test keeps filter and message in step | — | `infra/control-plane`, `config-changes.test.ts` | TF | not yet carried (M6: Dev → prod releases) |
| Cost kill switch (opt-in) | 0028, 0036 | `infra/billing/kill-switch.tf`; `infra/modules/project-budget` (+ workflow YAML) | TF | carried (TF): per entry, off by default |
| Safe deploy: no-traffic revision, smoke test (the caller's checks), then traffic; repo variables checked before the build | 0076, 0114 | `platform/actions/cloud-run-safe-deploy`, `cloud-run-caller-config`; `template/.github/workflows/deploy.yml` | A | carried (A): `cloud-run` projects only, `deploy.yml` (AI-206: M6.17) |
| Release (promote by digest, rollback by pinned revision then `/health`): inputs and the digest or revision checked before traffic moves; one run per environment | 0114 | `release.yml` → `platform/actions/cloud-run-release-check`, `cloud-run-rollback`, `cloud-run-safe-deploy`; `scripts/cloud-run-release.mjs` | A | carried (A): `cloud-run` projects, `template/.github/workflows/release.yml` (AI-206: M6.17); promote in `dev-and-prod` reads the dev repo as prod's deployer (AI-390: Promote in dev-and-prod: prod deployer reads the dev registry) |
| PR previews: same-repo PRs only (forks and Dependabot get no job, so no credential), no-traffic revision tagged `pr-<n>` on `<service>-preview`, at most 10 tags per service (oldest removed first, before and after the deploy), tag removed on close; one PR comment with the URL | 0028, 0114 | `preview.yml` → `cloud-run-caller-config`, `platform/actions/cloud-run-preview`; `scripts/cloud-run-preview.mjs` | A | carried (A): `cloud-run` projects, `template/.github/workflows/preview.yml` (AI-207: M6.18); jobs skip until `GCP[_DEV]_PREVIEW_SERVICE` is set |
| UI screenshot checks (Playwright): a diff fails, actual images uploaded; 10-minute cap; reduced motion while capturing; skips, passing with the reason, docs-only PRs and PRs where no changed file can affect the web app (AI-406); workers set by the app's `playwright.config.ts` (two here, AI-402) | 0045, 0059 | `ui-screenshots.yml` → `platform/actions/ui-screenshots`; config and images in `apps/web/e2e/`; skip rule `scripts/review-scope.mjs` (`canAffectWebApp`) | — | control plane only; a managed web UI can call the action (needs `playwright.config.ts`; input `base-ref`), but the web-app path list is this repo's layout, so a managed repo would need its own list before the skip helps (unknown paths run). Required here only (`github/source-only.json`, AI-350) |
| Fonts served by the app: the web build fails if a built file names a font host or loads a font from another host | 0151 | `apps/web/scripts/check-fonts.ts` (run by `pnpm build`) | — | control plane only; a managed web UI can copy the script |
| Refine caps (questions, children); email (20/day, 10-min batch) | 0028, 0075 | `packages/domain/src/{refine-gate,notify-email}.ts` | — | control plane |
| Epic breakdown caps: 12 tickets per proposal, 1 plan-epic task per epic in flight, 3 per epic in all, every drafted field length-capped | 0028, 0155 | `packages/contracts/src/entities/epic-breakdown.ts`, `packages/domain/src/runs.ts` | — | control plane |
| Push caps (6/hour, 30/day, then one "more waiting" push per window); quiet hours; no agent text in pushes; 10 subscriptions per user | 0028, 0052 | `packages/domain/src/notify-push.ts`, `packages/store/src/push-subscription-store.ts` | — | control plane |
| Spend notices: 80% of a cap and a stop, once per cap and window, 10 a day, no agent text | 0028 | `packages/domain/src/spend-notices.ts` | — | control plane |
| Membership caps: 20 members per project, 100 in all, checked inside `put`'s transaction; member reads capped to match | 0028, 0126 | `packages/store/src/membership-store.ts` | — | control plane |
| API request body cap (256 KB); UI poll floor 5 s | 0028, 0091 | `apps/api/src/app.ts`, `apps/web/src/lib/live.ts` | — | control plane only |
| Context budgets, PR ≤ half room, judged on its own change; hard only on files every session or agent step loads, `"warn": true` entries never fail; over on `main` warns and keeps one trim issue (`context-budget.json`; default `AGENTS.md`/`CLAUDE.md` ≤ 200 lines) | 0046, 0106, 0138, 0147 | `scripts/context-budget.mjs` in `platform/actions/ci-check`; `context-budget-trim` job (`ci.yml`) | A | carried (next baseline tag) |
| Review agents: lockfiles out of the diff (code first, 120 KB cap with truncation note); lockfile sources must be the npm registry with integrity | 0046 | `platform/actions/agent-review-prepare`; `scripts/lockfile-sources.mjs` in `platform/actions/ci-check` | A | carried (next baseline tag) |
| Agent evals (`agent-evals` check); skips non-agent changes | 0040, 0086 | `platform/actions/agent-evals` | A | control plane only; `agent-evals` and `agent-evals-plumbing` required here only (`github/source-only.json`, AI-352) |
| Executor permission profile (headless Claude Code) | 0040, 0051 | `platform/executor/profile.json` + `scripts/executor-profile.mjs`, installed by the reusable `claude-executor.yml` | M (`agent-run.yml` caller) | built (M1.6a); managed repos get the caller from the baseline; its token sits in a `main`-only `agent` environment (AI-106) |
| Plan-named packages: a trusted `deps` job resolves them (newest ≥ 7 days old, install scripts off, ≤ 5 per ticket) before the sandboxed build; nothing else may change | 0156 | `claude-executor.yml` (`deps` job) + `scripts/executor-deps.mjs` | M (`agent-run.yml` caller) | built (AI-386); managed repos get it through their caller of `claude-executor.yml@main` (ADR-0096); needs `pnpm-lock.yaml` and pnpm 10.16+ |
| Baseline PR on registration: missing files only, never workflows or settings, capped | 0142 | `github/registration.ts`, `baseline/plan.mjs` | — | control plane |
| Webhook caps (1 MB body, 300 signed deliveries/minute per instance) + HMAC + 30-day TTL on records | 0028, 0041 | `apps/api/src/webhooks.ts`, `infra/control-plane` | — | control plane only (managed repos only send webhooks) |
| Bot-opened PRs run their checks (repo token from the control plane via Actions OIDC; agent job holds no write credential) | 0041, 0043 | `system-security-review.yml` (`publish` job), `apps/api/src/github/token.ts` | — | not yet carried (until M6: Dev → prod releases) |
| Re-sync open PRs (clean merges only, capped; `no-auto-sync` label; only when PR sync is `all`) | 0111, 0157 | `platform/actions/resync-prs` | A, G | label carried; caller needs per-project tokens |
| Sandbox self-test on executor changes | 0071 | `platform/actions/sandbox-self-test` | A | platform only; a project hosting an executor pins the action. Required here only (`github/source-only.json`, AI-352) |
