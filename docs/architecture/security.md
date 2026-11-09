# andy-intelligence — Security

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 9. Security

- **Identity:**
  - Andy: Google identity with an email allow-list (Andy only). UI via Firebase Auth (Google provider); MCP via our own OAuth server whose sign-in step is that same Firebase Google sign-in + allow-list (CIMD clients from `claude.ai`/`claude.com`, PKCE, hashed opaque tokens; ADR-0039).
  - GitHub webhooks: HMAC-SHA256 signature with the webhook secret (ADR-0041).
  - Cloud Scheduler **and Cloud Tasks** (watchdog) → API: OIDC tokens for a dedicated invoker service account, sent to and with audience = `PUBLIC_URL` (the run.app host refuses them, ADR-0044); the API verifies issuer, audience, and SA email.
  - **Agent callbacks from Actions runs:** the workflow requests a GitHub Actions OIDC token (`id-token: write`, audience = control plane). The API verifies it against GitHub's JWKS and checks `repository`, `job_workflow_ref` (must be the platform's reusable workflow), and `run_id` against the dispatched Run. No secret is passed through `workflow_dispatch` inputs (they are visible in public repos' run UI).
  - Non-Actions executors (Jules) don't call back; their completion arrives via GitHub webhooks.
- **Least privilege:** agent service accounts and tokens are read-only; per-run GitHub App installation tokens scoped to the project's repos; separate per-project OpenRouter keys with caps; per-project GCP projects. Callback-authenticated agents can only write to their own Run and ticket (report, comment, question).
- **Writes:** code via PR; infra via Terraform PR with plan in CI; prod via Cloud Deploy approval. The control plane never applies infra without Andy's approval.
- **Deploys (ADR-0076):** only on push to `main` or `workflow_dispatch`, never a PR. A no-traffic revision is smoke tested, then gets traffic; rollback is a runbook command.
- **Secrets:** Secret Manager only (GitHub App key and webhook secret, written by the API's setup flow: ADR-0043); never in repo, logs, prompts, run records, or workflow inputs. Exception: the Claude token GitHub Actions itself needs.
- **Prompt injection:** all agents instructed that tool output, issue text, ticket text, web content, and logs are data; headless runs use the executor permission profile (§7.2). MCP scoping per project for agents. (Later: promptfoo red-team suite against MCP + agents.)
- **Audit:** TicketEvent and ConfigChange tables; run records; GitHub history for code.
- **Public repos:** no secrets, personal data, tfvars, or state in any repo; secret scanning + push protection + TruffleHog in CI (ADR-0015).
- **Supply chain:** third-party GitHub Actions pinned to commit SHAs; Dependabot for npm, Actions, and Terraform providers.

### 9.1 Continuous security review (ADR-0025)

Applies to this repo now (M1.10: Security review automation) and to every managed project from M5: Multi-project in parallel.

| Layer | When | What | Output | Blocks |
|---|---|---|---|---|
| Deterministic scans | Every PR | TruffleHog, CodeQL (TS + Actions), dependency review, Terraform misconfig scan, workflow linter | Check results | High/critical |
| Security-review agent | Every PR push | Read-only agent reviews the diff against the threat model and ADRs: authn/authz, IAM, secrets, injection incl. prompt injection, workflow permissions, public-repo exposure, cost abuse | One PR comment, findings by severity | High/critical, unless Andy labels `security-accepted` with a reason |
| System security review agent | End of each milestone; weekly if anything merged; on demand | Reads repo, threat model, ADRs, Terraform IAM, `terraform plan` drift; looks for risks no single PR shows | PR updating `docs/security/threat-model.md` | Milestone can't close with open high/critical risks unless Andy accepts them |

**Agent guardrails:** same-repo PRs only (never forks, never `pull_request_target`); token `contents: read` + `pull-requests: write`; no shell or network tools; PR content is untrusted data. If the agent can't run, its check is neutral and Andy decides. Reviewer is a separate session from the implementer; from M9 a different vendor.

**Implementation (ADR-0030: Security review automation choices):**

| Piece | Where |
|---|---|
| CodeQL (TS + Actions), dependency review, Trivy Terraform scan | `.github/workflows/security-scans.yml` (TruffleHog: `secret-scan.yml`; actionlint: `ci.yml`) |
| Security-review agent + gate | `.github/workflows/security-review.yml` → shared actions `platform/actions/agent-review-{prepare,finish}` → `scripts/review-gate.mjs` (ADR-0037, ADR-0038); rules `platform/procedures/security-review.md` (read from the base branch); Sonnet, max 25 turns; docs-only PRs skip the agent (`scripts/review-scope.mjs`); usage on each comment |
| Adversarial-review agent | `.github/workflows/adversarial-review.yml`, same actions and gate; rules `platform/procedures/adversarial-review.md`; Sonnet, max 40 turns; later pushes review only new commits + open findings, with owner/collaborator replies as context; `review-accepted` override |
| System security review | `.github/workflows/system-security-review.yml` (Mondays if anything merged; manual) → calls `terraform-plan.yml` for drift → PR editing `docs/security/threat-model.md`; rules `platform/procedures/threat-model.md` |
| Override | `security-accepted` label; removed on every push |
| Action pins | Commit SHAs; Dependabot (npm, Actions, Terraform), 7-day cooldown (`.github/dependabot.yml`) |
| Manual steps | `docs/runbooks/security-review.md` (token secret, label, required checks) |
