# Build log

Temporary progress log until andy-intelligence can track its own work (then migrated to tickets).

## 2026-10-21 — M0: Foundations: repo, sign-in, GCP infra started

**Decided (Andy):** GitHub org `albernhagen-org` (superseded: personal public repo `albernhagen/andy-intelligence`, ADR-0003); GCP project `andy-intelligence-512400`; Neon free tier; `us-central1`; default run.app URL; standard TS stack. See ADR-0003, 0007, 0008, 0009.

**Done (branch `m0/foundations`):**

- Monorepo scaffold, CI (lint, typecheck, test, build, terraform fmt/validate).
- `@andy/contracts`: §5 entities as Zod, ports, fakes + contract suites for WorkTracker / Executor / QuotaSource (8 tests).
- `@andy/store`: Firestore client and Zod-validated converters (4 tests). (Replaced the earlier Drizzle/Postgres package before anything was deployed.)
- `@andy/api`: Hono + OpenAPI, `/health`, `/config.json`, `/api/me` behind Firebase token + allow-list (5 tests); serves the SPA.
- `@andy/web`: React/Vite/Tailwind/shadcn shell with Google sign-in.
- Dockerfile; deploy and terraform-plan workflows (WIF, no keys).
- Terraform: `infra/bootstrap`, `infra/control-plane` (google provider 8.8). **Not validated locally** — the workspace can't reach the Terraform registry; CI runs `terraform validate`.
- ADRs 0001–0017; runbook `docs/runbooks/m0-setup.md`.

**Verified locally:** tests, typecheck, lint, builds, and a smoke run of the bundled server (`/health` 200, `/api/me` 401, SPA fallback 200).

**Decided (Andy, later 2026-10-21):** repo is public (ADR-0015: secret hygiene, TruffleHog + GitHub push protection); CI plans / local applies and public service with app-level auth confirmed (ADR-0010, 0011). Neon reconfirmed after checking Cloud SQL has no free tier (~$10/mo minimum).

**Decided (Andy, 2026-10-21 evening):** repo transferred to personal account `albernhagen/andy-intelligence` (ADR-0003). Work tracking moves into the app: Postgres tickets + in-app story board + MCP; GitHub only for code (ADR-0016, supersedes 0004). ARCHITECTURE.md updated (§1–4, 5, 6, 7, 8, 9, 10, 11, 12, 13). DB schema and contracts updated before any migration was applied (tickets as system of record, `ticket_events`, `ticket_dependencies`, project ticket keys). Stay on Neon (Supabase free tier pauses after a week idle and duplicates Firebase/GCP features).

**Decided (Andy, 2026-10-21 late):** Firestore replaces Neon/Postgres (ADR-0017, supersedes 0008 and 0013). Event-driven flow: per-run Cloud Tasks watchdog instead of a polling reconciler; weekly scout is the only scheduled job. Cloud SQL priced at ≈$9.50/mo and rejected.

## 2026-10-22 — PR #1: Foundations opened; M1.0: Docs sync

- PR #1: Foundations opened: `m0/foundations` → `main`. Runbook steps 0–4 still pending.
- M1.0: Docs sync folded into PR #1: Foundations to avoid a stacked PR; PR #2: Docs sync closed: ARCHITECTURE revision `2026-10-22a`; ADRs 0018–0023; `AGENTS.md` (+ `CLAUDE.md` symlink); PR template with docs checklist; build prompt moved to slices.
- **Decided (Andy):** ADR-0012 rejected — every port gets a fake + contract suite, written in the slice that first uses the port (ADR-0023). Docs ship with the change (ADR-0022). M1: First end-to-end flow split into slices (ADR-0021).
- **Decided (Andy):** no stacked PRs — slices branch from latest `main` (ADR-0021). Terraform pinned to 1.16.7 via `.terraform-version`, managed with tenv (ADR-0024). Docs written short and plain (ADR-0022).

## 2026-10-23 — Security review designed

- **Decided (Andy):** security is checked by agents on every PR and across the system over time (ADR-0025, ARCHITECTURE §9.1). New slice M1.10: Security review automation.
- **Defaults (Andy to confirm):** high/critical agent findings block merge, overridable with the `security-accepted` label; reviewer runs on the Claude subscription token; system review weekly (if anything merged) + end of each milestone.
- **Seed risks for the threat model:** CI's `tf-plan` identity has basic Viewer (likely reads Firestore data and logs) and is usable from any same-repo branch; repo secrets readable by same-repo branch workflows; public Cloud Run URL (cost abuse); Firebase web API key is public by design.

## 2026-10-27 — M0: Foundations done; plan additions

- Merged: PR #1: Foundations, PR #3: gitignore Terraform plan files, PR #4: first Terraform apply, PR #5: service_url host.
- Infra applied by Andy (bootstrap 15 + 2 IAM fixes; control plane 27). CI plan shows "No changes". Deploy green. Google sign-in works at `https://control-plane-662512537397.us-central1.run.app`.
- Lessons: Identity Platform needs a quota project with local credentials; CI's `tf-plan` needed `serviceusage.serviceUsageConsumer` and `firebaserules.viewer`; Google sign-in provider is enabled by hand in Firebase (needs an OAuth client no API can create).
- Git history rewritten on all 4 repos to replace Andy's Gmail with the noreply address.
- **Decided (Andy):** adversarial PR review (ADR-0026), local quality gates (ADR-0027), GCP cost guardrails (ADR-0028). Custom domain after M5: Dev → prod releases.

## 2026-10-27 — M1.13: GCP cost guardrails built

- Branch `m1.13/gcp-cost-guardrails`. New root `infra/billing`: $25/month budget for `andy-intelligence-512400`, alerts at 50%, 90%, 100% actual and 100% forecast. Control plane: Cloud Run timeout 60s, concurrency 80; log exclusion for successful `/assets/*` and `/health` request logs; retention left at 30 days.
- **Decided (Andy, ADR-0029):** `infra/billing` plans locally only (no billing role for `tf-plan`, no Actions secret); alerts go to the billing account's default admin/user recipients; kill switch split into new slice M1.14: Cost kill switch (off, not built; depends only on M1.13, Needs-you item added after M1.2: Ticket core); new slice M1.15: Usage alerts, because GCP has no hard cap on egress, Firestore ops or log volume and budgets lag by hours.
- Verified (Google docs): no "send test alert" exists. **Decided (Andy, 2026-10-28):** instead of a $0.01 live test, "Done when" checks recipient + delivery: Andy is billing admin (default recipient) and `cloudplatform-noreply@google.com` mail reaches his inbox. Budget confirmed in the console. The live test stays optional in the billing runbook.
- Applied by Andy (2026-10-28): control plane (log exclusion added, Cloud Run timeout 300s → 60s), billing (Budget API enabled, budget created). CI plan for control plane: "No changes".
- Lessons: Cloud Run revision labels from the deploy workflow are now in `ignore_changes` (plans would strip them); the provider hides `calendar_period = "MONTH"` from plans because monthly is the API default.

## 2026-10-28 — M1.13: GCP cost guardrails merged; M1.15: Usage alerts built

- Merged: PR #7: GCP cost guardrails.
- Branch `m1.15/usage-alerts`: email channel + six Cloud Monitoring alert policies in `infra/control-plane` (Cloud Run requests and bytes sent; Firestore reads, writes, deletes; log ingestion). Monitoring API enabled. Thresholds in `usage_alert_thresholds` (billing runbook section 5).
- **Decided (Andy):** alert address is its own variable `alert_email` (gitignored tfvars + `TF_VAR_ALERT_EMAIL` Actions secret), not the allow-list; default thresholds as in the runbook.
- Verified: alerting is free until at least 2027-09-01 (then $0.35 per metric reference/month + $0.50 per million points). Firestore metric names from Firestore docs; Cloud Run and log metric names not confirmed from Google's reference pages (too large to read); the apply accepted all six.
- Applied by Andy (2026-10-28). Test: request threshold set to 0 → alert email arrived within minutes → restored. Firestore document metrics confirmed under the Cloud Firestore Database resource in Metrics Explorer (no data yet: nothing uses Firestore until M1.2: Ticket core). CI plan: "No changes".
- Lesson: `evaluation_missing_data` needs a non-zero `duration`; dropped (a threshold condition with no data stays inactive anyway).

## 2026-10-28 — M1.15: Usage alerts merged; M1.12: Local quality gates built

- Merged: PR #8: Usage alerts.
- **Decided (Andy):** slice order M1.12: Local quality gates → M1.10: Security review automation → M1.2: Ticket core ‖ M1.1: MCP OAuth spike → M1.14: Cost kill switch → M1.11: Adversarial PR review.
- Branch `m1.12/local-quality-gates`: lefthook 2.2.2 (verified current; `prepare` script installs hooks because pnpm 10 blocks dependency postinstall scripts, skipped without `.git` for the Docker build); pre-commit prettier/eslint/`terraform fmt`/actionlint on staged files; pre-push typecheck + tests; Claude Code `PostToolUse` hook in `.claude/settings.json` (platform plugin doesn't exist yet).
- **Decided (Andy):** actionlint locally via brew, skipped with a message when missing; CI gets an actionlint job (checksum-verified v1.7.12 release binary, no third-party action). M1.12 "Done when" changed from "CI unchanged" accordingly.
- Verified locally: a commit with an ESLint error, a Prettier issue and an unformatted `.tf` is blocked; the hook script formats an edited file and returns exit 2 with the ESLint error for unfixable issues. actionlint not run locally (sandbox can't run downloaded binaries); CI runs it.
- Fixed: blank lines that split the M1 slice table in ARCHITECTURE §12.

## 2026-10-28 — M1.12: Local quality gates merged; M1.10: Security review automation built

- Merged: PR #9: Local quality gates.
- **Decided (Andy):** M1.10 defaults confirmed (high/critical block, `security-accepted` override, subscription token, system review weekly if anything merged + milestone end); override label removed on every push; Trivy release binary for the Terraform scan; drift summary included now (ADR-0030: Security review automation choices).
- Branch `m1.10/security-review`: `security-scans.yml` (CodeQL TS + Actions, dependency review, Trivy), `security-review.yml` + tested gate script, `system-security-review.yml` (calls a now-reusable `terraform-plan.yml`), all actions pinned to SHAs, Dependabot (npm, Actions, Terraform; 7-day cooldown), `docs/security/threat-model.md` v1 (R1–R8), procedures in `platform/procedures/`, runbook `docs/runbooks/security-review.md`.
- Verified (official docs, 2026-10-28): `claude-code-action` v1.0.264 inputs (`claude_code_oauth_token`, `prompt`, `claude_args`, `--json-schema` → `structured_output`); `claude setup-token` gives a one-year token, model requests only; `trivy-action` tags were hijacked in March 2026 (CVE-2026-33634), so the binary is used.
- Verified locally: gate tests; actionlint clean (v1.7.12 binary); `trivy config --severity HIGH,CRITICAL infra` finds nothing. Not verifiable locally: the agent run, CodeQL, dependency review (CI and the demo PR do that).
- **Decided (Andy, later 2026-10-28):** cut reviewer quota, since it shares the subscription with all other Claude use: Sonnet, max 25 turns, docs-only PRs skip the agent, usage (turns, tokens, API-equivalent estimate) on every comment (ADR-0030).
- Lesson: on `pull_request`, a PR runs its own workflow files; procedure and threat model are read from the base branch, the rest is threat-model risk R5.

## 2026-10-28 — M1.10: Security review automation merged and demoed; project baseline planned

- Merged: PR #10: Security review automation. Andy: reviewer token secret, label, repo security settings, Actions PR setting and `protect-main` ruleset done.
- Demo (PR #12, closed): planted `roles/owner` on `tf-plan` → **critical** finding, `security-review` failed (5 turns, ~62k input tokens, ≈ $0.05 API-equivalent on Sonnet); `security-accepted` → passed without re-running the agent; new push → label removed, failed again. Trivy (`terraform-misconfig`) did **not** flag `roles/owner`; the agent is the only check that caught it.
- Manual system review (run 40726081488): drift plan "No changes"; opened PR #13: Security: system review 2026-10-28 (adds R9, low; 0 open high/critical). Its checks needed manual approval (PR author `github-actions[bot]`) and its edit failed lint (unformatted); fixed in PR #15: format system-review edits. App-token switch added to M1.5: GitHub App + project registration.
- **Decided (Andy):** project baseline (ADR-0031): every guardrail is packaged for managed projects (reusable workflows pinned by SHA, template files, declarative GitHub config, Terraform modules) and tracked in ARCHITECTURE §8.1. New slice M1.16: Project baseline v1, after M1.11: Adversarial PR review and before M1.8: Build + gate.

## 2026-11-01 — Deployment modes and standalone devkit planned

- **Decided (Andy, ADR-0032: Deployment modes and a standalone devkit):** three layers: devkit (vendor-neutral procedures + skills over MCP), control plane (one host for it), deployment mode (`gcp` now, `local` later). Devkit first: installs into Claude Code and works alone, tickets as markdown in the project repo; full local control plane later. Devkit lives in `devkit/` in this repo as a Claude Code plugin marketplace.
- Rule from now on: GCP specifics (runs/config/spend storage, Cloud Tasks, Firebase Auth) go behind ports when first built or touched (affects M1.2: Ticket core, M1.6: Claude Code executor).
- Detailed design after M1: First end-to-end flow (ARCHITECTURE open question 11).

## 2026-11-01 — Pluggable context sources planned

- **Decided (Andy, ADR-0033: Pluggable context sources):** agents get product/domain context from pluggable sources per project: markdown docs (handwritten or copied in) now; read-only MCP servers (Notion first) and custom skills later. Scopes: global → project → step. No integration built now.
- Detailed design after M1: First end-to-end flow (ARCHITECTURE open question 12).

## 2026-11-01 — Multi-project moved up; data evolution planned

- **Decided (Andy, ADR-0035: Multi-project milestone moved up; data evolution):** new M2: Multi-project in parallel right after M1: First end-to-end flow, including stories by project; later milestones renumbered (M3: Add Jules + model routing, M4: Paid models + spend caps, M5: Epics + story board, M6: Dev → prod releases).
- Control-plane Firestore is live data from M1.2: Ticket core on: additive schema changes, versioned upgraders for breaking ones, backups + manual export before risky deploys (ARCHITECTURE §10.4).
- Follow-up (not urgent): the GCP project ID is hardcoded as Terraform variable defaults and backend bucket names; make them settings so another install (ADR-0032) can deploy. Identifiers in docs are not secrets.

## 2026-11-01 — PR #14, PR #15 and PR #16 merged; M1.2: Ticket core built

- Merged: PR #14: Project baseline, deployment modes, context sources plan (ADR-0031, ADR-0032, ADR-0033); PR #15: format system-review threat-model edits; PR #16: M2: Multi-project in parallel and data evolution plan (ADR-0035).
- **Decided (Andy):** Andy can force any stage move with a reason (recorded in history; agents can't); Firestore backups kept 7 days; epics need only intent + no open questions; Firestore adapter suite runs locally only, not in CI (ADR-0034: Contract suites that need an emulator run locally).
- Branch `m1.2/ticket-core`: `WorkTracker` port reshaped around Project/Ticket/TicketEvent/Question (every write appends its event atomically) + fake + contract suite; `packages/domain` (stage moves, Definition of Ready, Needs-you); `FirestoreWorkTracker`; ticket REST API (`/api/projects…`, `/api/needs-you`, 256 KB body cap); Terraform: Cloud Tasks `run-watchdog` queue (capped), `tasks-invoker` SA, daily Firestore backup. Runbook `docs/runbooks/ticket-core.md`.
- Verified locally: lint, typecheck, 83 tests, build; Trivy clean. Not run here: `terraform validate` (no registry access; CI runs it) and `pnpm test:firestore` (no Java; Andy runs it).
- Open on `main`: Dependabot alerts for `@grpc/grpc-js` (high, low; via `firebase` web SDK), `glob`, `minimatch` (medium); no fix PRs yet.

## 2026-11-01 — M1.2: Ticket core merged; M1.14: Cost kill switch built

- Merged: PR #17: Ticket core. Andy to run: `infra/control-plane` apply (6 adds), `pnpm test:firestore`, Done-when check (`docs/runbooks/ticket-core.md`).
- **Decided (Andy, ADR-0036: Kill switch runs on Cloud Workflows):** Cloud Workflows instead of a function; Needs-you item deferred until M1.3: UI: tickets + inbox; switch stays on in Andy's tfvars after the demo (code default off).
- Verified (Google docs): manual scaling at 0 instances disables a Cloud Run service without a new revision; budget messages arrive several times a day, at least once, with `costAmount`/`budgetAmount`.
- Branch `m1.14/cost-kill-switch`: `infra/billing/kill-switch.tf` (topic, Eventarc trigger, workflow, `cost-kill-switch` SA with a custom role) behind `kill_switch_enabled`; 150% budget threshold; billing runbook §4 (turn on, fake-message test, re-enable, turn off).
- Verified locally: `terraform fmt`, Trivy clean, workflow YAML parses. Not run here: `terraform validate` (CI) and the apply + fake-message demo (Andy).

## 2026-11-01 — M1.14: Cost kill switch merged; role narrowed

- Merged: PR #18: Cost kill switch.
- Security review (low): the kill switch's Cloud Run permissions were project-wide. Follow-up PR binds `run.services.get/update` on the `control-plane` service only; queue list/pause and operation polling stay project-level (no narrower resource). This narrows the identity row in ADR-0036: Kill switch runs on Cloud Workflows.

## 2026-11-01 — Kill switch plan fix

- Andy applied `infra/control-plane` (6 added) and `infra/billing` without the switch (1 change: 150% threshold). With `kill_switch_enabled = true` the plan failed: `for_each` keyed by a custom role name unknown until apply. Fixed with static keys; budget threshold rules reordered to match the API (the plan showed a swap). Lesson: `terraform validate` doesn't catch unknown `for_each` keys; only a plan does, and `infra/billing` plans locally only.
- Applied by Andy from this branch: 15 added, 1 changed. **Demo passed:** fake budget message at 200% → workflow `SUCCEEDED`, `/health` 503 (manual scaling at 0 accepted with `launchStage: BETA`), `run-watchdog` `PAUSED`. Switch left on in Andy's tfvars. M1.14: Cost kill switch Done when met.

## 2026-11-01 — PR #20 merged; M1.11: Adversarial PR review built

- Merged: PR #20: kill switch plan fix (applied and demoed first).
- **Decided (Andy, ADR-0037: Review agents share composite actions; adversarial re-reviews are incremental):** blockers clear by re-review with replies as context; shared plumbing; Sonnet, 40 turns, docs-only skip; quota kept low with incremental re-reviews. Composite actions instead of a reusable workflow, because a reusable workflow renames the required `security-review` check.
- Branch `m1.11/adversarial-review`: `adversarial-review.yml`, `.github/actions/agent-review-{prepare,finish}`, `scripts/review-gate.mjs` (replaces `security-review-gate.mjs`; scope script renamed to `review-scope.mjs`), procedure + schema, `security-review.yml` moved onto the shared actions, runbook `docs/runbooks/adversarial-review.md`.
- Verified locally: gate tests (38 in `scripts`), actionlint clean. Not verifiable locally: the agents (this PR's own checks run both), the demo (after merge).

## 2026-11-02 — M1.11: Adversarial PR review merged and demoed; M1.16: Project baseline v1 started

- Merged: PR #21: Adversarial PR review. (PR #20: kill switch plan fix was applied and demoed before it merged; see 2026-11-01.)
- Demo (PR #22, closed): a planted off-by-one got a `blocker` with a failing scenario (≈ $0.05 API-equivalent). The fix push re-reviewed incrementally (`incremental review since <sha>`) and listed both findings under Resolved. A second planted bug got 2 blockers; `review-accepted` passed the check in ≈ 10 s without running the agent; a new push removed the label and the check failed again. M1.11: Adversarial PR review Done when met.
- Andy created the `review-accepted` label and added `adversarial-review` to the required checks in `protect-main`.
- Branch `m1.16/project-baseline` started.

## 2026-11-02 — M1.16: Project baseline v1 built

- **Decided (Andy, ADR-0038: Baseline carried by composite actions):** composite actions in `platform/actions/` instead of reusable workflows (those only run from `.github/workflows/`, rename checks, and can't see their own commit); this repo calls them locally, managed repos pin a SHA; template = managed / seed / starter files listed in `platform/baseline/manifest.json`; GitHub config applied by `baseline.mjs` with Andy's `gh` (never CI); drift: `check` locally, labels + ruleset in the weekly system review; tags `vX.Y.Z`, Dependabot bumps pins; demo on a public scratch repo with no Claude token.
- Branch `m1.16/project-baseline`: 9 actions; callers keep the 10 required check names (a test compares them with `github/ruleset-main.json`); `template/`; `platform/baseline/{manifest.json,github/*.json,baseline.mjs}` + tests; runbook `docs/runbooks/onboard-a-repo.md`; threat model R5 updated, R10 added.
- Verified locally: lint, typecheck, tests (scripts project 73); `check albernhagen/andy-intelligence` (read-only) finds real drift: private vulnerability reporting off, SHA pinning not required, default workflow token `write`, `security-accepted` label colour/description (runbook §1 applies them); a rendered starter repo passes `pnpm lint/typecheck/test/build`. Not run here: actionlint (not installed; CI runs it), the composite actions themselves (this PR's checks run them), the scratch-repo demo (Andy, runbook §5).
- **Demo passed (Andy, 2026-11-02, scratch repo `albernhagen/baseline-scratch`, public, no Claude token):** `onboard --ref origin/m1.16/project-baseline` pushed the files and applied every settings section (`ok`); `CI` passed on `main` with the actions pinned from this repo; test PR #1 there showed the same 10 required checks, all passing, `CLEAN MERGEABLE`, both review agents "not reviewed"; `check` → no drift, exit 0; workflow permissions set to read-and-write by hand → `actions: drift … want "read", have "write"`, exit 1. M1.16: Project baseline v1 Done when met.
- Demo fixes: `files` puts a `pnpm` shim on PATH when pnpm isn't installed (the clone's lefthook hooks call `pnpm`), and commits with this checkout's git identity (GitHub rejected the global private email, GH007). Andy installed pnpm (Homebrew; it switches to the pinned 10.28.0) and set the noreply address globally.
- Lessons: ESLint 10 picks up nested `eslint.config.js`, so starter config files end in `.template`; a `\s*$` regex in multiline mode swallowed newlines when pinning.

## 2026-11-02 — M1.16: Project baseline v1 merged; M1.1: MCP OAuth spike started

- Merged: PR #23: Project baseline v1. Tagged `v1.0.0` (managed repos pin the baseline actions to this tag's SHA).
- Andy applied the 4 repo settings `check` reported as drift: private vulnerability reporting on, SHA pinning required for actions, default workflow token read-only, `security-accepted` label colour and description.
- Branch `m1.1/mcp-oauth-spike` started.

## 2026-11-02 — M1.1: MCP OAuth spike built

- **Decided (Andy, ADR-0039: MCP OAuth facade):** our own OAuth authorization server in the API; sign-in step = the existing Firebase Google sign-in + allow-list; clients via CIMD (client ID metadata documents on `claude.ai`/`claude.com`), no DCR; live proof after merge (the deployer only deploys `main`).
- Verified (Claude connector docs, 2026-11-02): 401 + `resource_metadata` discovery, exact `resource` match, DCR or CIMD, PKCE S256, refresh-token rotation, callback `https://claude.ai/api/mcp/auth_callback`. Google directly needs a hand-made client + secret and gives no refresh tokens: rejected.
- Branch `m1.1/mcp-oauth-spike`: `OAuthGrantStore` port + fake + contract suite + `FirestoreOAuthGrantStore`; `apps/api/src/mcp/` (discovery, `/oauth/authorize`, `/api/oauth/approve`, `/oauth/token`, stateless `/mcp` with a throwaway `ping`); SPA page `/oauth/consent`; `frame-ancestors 'none'` on every response; Terraform: `PUBLIC_URL` env + Firestore TTL on `oauthGrants`. Runbook `docs/runbooks/mcp-connector.md`; threat model R11–R13.
- Verified locally: lint, typecheck, tests (MCP SDK's own OAuth client completes discovery → CIMD → consent → token → `ping` → refresh rotation against the app), build, smoke run of the bundle. Not run here: `pnpm test:firestore` (no Java), `terraform validate`/plan, Trivy (CI), the Claude desktop connector (Andy, runbook).
- Andy to run after merge: `infra/control-plane` apply (1 add, 1 change), `pnpm test:firestore`, runbook §3–4 (connector + `ping`; non-allow-listed account rejected). That is M1.1: MCP OAuth spike's Done when.

## 2026-11-02 — M1.3: UI: tickets + inbox built

- **Decided (Andy):** seed questions with "Ask a question…" on ticket detail; API client generated from OpenAPI (`openapi-typescript` + `openapi-fetch`, staleness test); no browser e2e yet (Playwright + Firebase Auth emulator is a follow-up).
- PR #28: M1.3: UI: tickets + inbox: Needs-you inbox (home), projects, tickets by stage, ticket detail (edit, Definition of Ready, moves incl. forced move with a reason, questions, history). UI tests run against the real API in-process. Not checked in a real browser (needs sign-in): Andy runs the Done when after deploy.
- Kill switch's Needs-you item (deferred to after this slice, 2026-11-01) is still not built: it needs workflow → API auth; its own slice.

## 2026-11-02 — M1.1: MCP OAuth spike merged and demoed

- Merged: PR #29: MCP OAuth spike and PR #28: UI: tickets + inbox. Both review agents passed with no blocker or high/critical finding; the 5 lower findings were fixed before merge (threat-model table, lookup caps, failed-lookup cache, refresh tests, consent text; R14 added).
- Applied by Andy: `infra/control-plane` (`PUBLIC_URL` env, `oauthGrants` TTL). `pnpm test:firestore` passed (19 tests, incl. the 5 `OAuthGrantStore` contract tests) once Java was installed.
- **Demo passed:** Claude custom connector added with `https://control-plane-662512537397.us-central1.run.app/mcp`; Google sign-in + Approve on the consent page; `ping` from a Claude session returned `pong (signed in as <Andy's email>)`. Claude used CIMD (the server offers no other registration), so DCR isn't needed.
- Allow-list rejection: **Decided (Andy):** no second Google account; the automated tests are the proof (non-allow-listed account → 403 at approve, removed email → 401 on `/mcp` and `invalid_grant` on refresh). Live probes without credentials all refused: approve with no or a forged token → 401, `/mcp` with a random token → 401, a made-up code → `invalid_grant`, a non-Claude `client_id` → `invalid_client`.
- M1.1: MCP OAuth spike Done when met. M1.4: MCP core tools is unblocked on the auth side (still needs M1.2: Ticket core, merged).
- Lesson: the emulator needs a Java runtime; the runbooks now say how to install one.

## 2026-11-02 — M1.4: MCP core tools built

- **Decided (Andy):** remove the throwaway `ping` (`status` with no ticket is the connection check); find tickets by key with a domain helper (project id = lowercased key prefix, then match), no port change; `status` = one ticket by key, or an overview when no key is given.
- PR #31: MCP core tools (branch `m1.4/mcp-core-tools`): `apps/api/src/mcp/tools.ts` with `create_ticket`, `list_needs_me`, `answer_question`, `status`, all through the REST API's `TicketService`; `TicketService.findByKey/status/overview` in `packages/domain`. Threat model: `/mcp` row, R12 reassessed, R15 (agent-written question text reaching Claude desktop).
- Follow-up (adversarial review on PR #31): `status` reads whole projects. Add `getTicketByKey` + per-stage counts to the `WorkTracker` port before ~1,000 tickets in a project or M2: Multi-project in parallel (ARCHITECTURE §7.1).
- Verified locally: lint, typecheck, tests (MCP SDK client in-process: each tool, tool errors, the create → question → answer → Ready flow), build. Not run here: the Claude desktop check (Andy, runbook `mcp-connector.md` §4b, after deploy). No Terraform or Firestore adapter change.

## 2026-11-03 — AI-native SDLC playbook gaps planned

- Compared the plan with Anthropic's [AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook). Most of it is already planned.
- **Decided (Andy, ADR-0040: Close the gaps against Anthropic's AI-native SDLC playbook):** new slices M1.17: Agent evals v1 and M1.18: Plan step; executor permission profile in M1.6: Claude Code executor; verification output, acceptance-criteria review pass and nit cap in M1.8: Build + gate; review-capacity cap and learning loop in M2: Multi-project in parallel; DORA metrics in M6: Dev → prod releases.
- **Decided (Andy):** `README.md` gets a one-screen "How it works today" section, updated with every feature change (AGENTS.md docs table).
- Wave 1 (in parallel): PR #31: M1.4: MCP core tools and PR #32: M1.5: GitHub App + project registration open; they update "How it works today" after this merges.

## 2026-11-03 — PR #33 merged; Dependabot auto-merge built

- Merged: PR #33: AI-native SDLC playbook gaps plan (ADR-0040). PR #31: M1.4: MCP core tools and PR #32: M1.5: GitHub App + project registration synced with `main`.
- **Decided (Andy, ADR-0042: Dependabot auto-merge for patch and minor updates; CODEOWNERS requests Andy's review):** npm patches and minors of 1.0+ packages auto-merge after every required check; majors, 0.x minors, GitHub Actions and Terraform providers stay manual (review findings); `deploy.yml` skips bot merges; `* @albernhagen` in CODEOWNERS so Andy is notified of Dependabot PRs (review not required).
- Branch `m1.0/dependabot-auto-merge`: `dependabot-auto-merge.yml` → `platform/actions/dependabot-auto-merge` (fetch-metadata v3.1.0, pinned) → `scripts/dependabot-merge.mjs` + tests; job runs the base branch's action; baseline: workflow (managed), CODEOWNERS (seed), `allow_auto_merge: true`; threat model R17; runbook `onboard-a-repo.md` §6.
- Verified locally: scripts tests (decision + CLI), Prettier. Not run here: actionlint (CI), the first real auto-merge (Andy, runbook §6).

## 2026-11-03 — M1.5: GitHub App + project registration built

- **Decided (Andy, ADR-0041: GitHub App credentials and webhook intake):** andy-intelligence is project #1 (open question 8; side projects in M2: Multi-project in parallel). Two private Apps from manifests: read-only control-plane App (webhooks) and a review bot App (contents + PR write, this repo only) so the control-plane key never leaves Secret Manager. Control-plane key + webhook secret in Secret Manager (Andy adds versions with `gcloud`); bot key in a `main`-only `system-review` environment.
- Branch `m1.5/github-app`: `CodeHost` (`getRepo`) + `CodeEventLog` ports, fakes, contract suites; `FirestoreCodeEventLog` (`create()` per delivery ID); new `@andy/github` (`GitHubCodeHost` on `@octokit/auth-app`, HMAC via `@octokit/webhooks-methods`, payload mapping); `POST /webhooks/github` (1 MB, 300/minute per instance, HMAC, registered repos only); `ProjectService` (repo must have the App, one project per repo); repo field on the new-project form; Terraform: 2 secrets, runtime `secretAccessor` on them, `codeHostEvents` TTL, env behind `github_app_id`; `system-security-review.yml` opens its PR with the bot token. Runbook `docs/runbooks/github-app.md`; threat model R18, R19, R9 narrowed.
- Verified locally: lint, typecheck, tests, build; `terraform validate`; smoke run of the bundle (unsigned delivery → 401, `/health` 200). Not run here: `pnpm test:firestore` (no Java), the GitHub contract suite (needs the App), actionlint/Trivy (CI).
- Andy to run after merge: runbook `github-app.md` §1–6 (apply 5 adds; create App; apply 1 change; register `AI`; review bot; Done when: PR event recorded, redelivery → `duplicate`).

## Slices: M1: First end-to-end flow: ticket → PR with Claude

Status: todo / in progress / PR open / merged. Definitions: ARCHITECTURE §12.

| Slice                                   | Size            | Depends on                                                                                  | Status           |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- | ---------------- |
| M1.0: Docs sync                         | S               | M0: Foundations                                                                             | merged (PR #1)   |
| M1.1: MCP OAuth spike                   | M               | M0: Foundations                                                                             | merged (PR #29)  |
| M1.2: Ticket core                       | M               | M0: Foundations                                                                             | merged (PR #17)  |
| M1.3: UI: tickets + inbox               | M               | M1.2: Ticket core                                                                           | merged (PR #28)  |
| M1.4: MCP core tools                    | S               | M1.1: MCP OAuth spike, M1.2: Ticket core                                                    | merged (PR #31)  |
| M1.5: GitHub App + project registration | M               | M1.2: Ticket core                                                                           | PR open (PR #32) |
| M1.6: Claude Code executor              | L (split 6a/6b) | M1.5: GitHub App + project registration                                                     | todo             |
| M1.7: Refinement                        | M               | M1.3: UI: tickets + inbox, M1.4: MCP core tools, M1.6: Claude Code executor                 | todo             |
| M1.8: Build + gate                      | M               | M1.7: Refinement, M1.16: Project baseline v1, M1.17: Agent evals v1, M1.18: Plan step       | todo             |
| M1.9: Quota capture                     | S               | M1.6: Claude Code executor                                                                  | todo             |
| M1.10: Security review automation       | M               | M0: Foundations                                                                             | merged (PR #10)  |
| M1.11: Adversarial PR review            | M               | M1.10: Security review automation                                                           | merged (PR #21)  |
| M1.12: Local quality gates              | S               | M0: Foundations                                                                             | merged (PR #9)   |
| M1.13: GCP cost guardrails              | S               | M0: Foundations                                                                             | merged (PR #7)   |
| M1.14: Cost kill switch                 | M               | M1.13: GCP cost guardrails                                                                  | merged (PR #18)  |
| M1.15: Usage alerts                     | S               | M1.13: GCP cost guardrails                                                                  | merged (PR #8)   |
| M1.16: Project baseline v1              | M               | M1.10: Security review automation, M1.11: Adversarial PR review, M1.12: Local quality gates | merged (PR #23)  |
| M1.17: Agent evals v1                   | M               | M1.11: Adversarial PR review, M1.16: Project baseline v1                                    | todo             |
| M1.18: Plan step                        | M               | M1.6: Claude Code executor, M1.7: Refinement                                                | todo             |

**Next (order decided by Andy, 2026-10-28):**

1. M1.12: Local quality gates (merged).
2. M1.10: Security review automation (merged).
3. M1.2: Ticket core and M1.1: MCP OAuth spike, in parallel (both merged).
4. M1.14: Cost kill switch.
5. M1.11: Adversarial PR review (merged).
6. M1.16: Project baseline v1 (merged, `v1.0.0`).

**Waves (Andy, 2026-11-03, ADR-0040):** 1. M1.4: MCP core tools ‖ M1.5: GitHub App + project registration → 2. M1.6a: dispatch + callback ‖ M1.17: Agent evals v1 → 3. M1.6b: watchdog + retry ‖ M1.7: Refinement ‖ M1.9: Quota capture → 4. M1.18: Plan step → 5. M1.8: Build + gate.

**Pending decisions (Andy):**

- Claude plan and headless billing (open question 5); needed by M1.6: Claude Code executor.
- Local mode design (open question 11); due after M1: First end-to-end flow.
- Context sources design (open question 12); due after M1: First end-to-end flow.

**Blocked on Andy:** nothing.
