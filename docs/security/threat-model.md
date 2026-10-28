---
version: 1
last_reviewed: 2026-10-28
reviewed_by: M1.10: Security review automation (seed, by hand)
---

# Threat model — andy-intelligence

Living doc (ADR-0025: Agentic security review). Update it in the same PR whenever you add or change a trust boundary, entry point, credential, or IAM grant. The system security review (`platform/procedures/threat-model.md`) updates it weekly and at each milestone end.

**Milestone gate:** a milestone isn't done while a `high` or `critical` risk below is `open`, unless Andy marks it `accepted` with a reason.

Severity: `critical` (exploitable now, big blast radius) · `high` (exploitable with modest effort, or big blast radius) · `medium` (needs an unlikely precondition) · `low` (defense in depth).

## Assets

| Asset                       | Where                                                                            | Why it matters                        |
| --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| Tickets, runs, questions    | Firestore (default DB, `andy-intelligence-512400`)                               | Only copy of work tracking (ADR-0017) |
| GCP project and billing     | `andy-intelligence-512400`                                                       | Cost abuse, data access               |
| Repo `main` branch          | GitHub `albernhagen/andy-intelligence` (public)                                  | Push to `main` deploys to Cloud Run   |
| Claude subscription         | `CLAUDE_CODE_OAUTH_TOKEN` Actions secret                                         | Quota theft; tied to Andy's account   |
| Allow-list and alert emails | `TF_VAR_ALLOWED_EMAILS`, `TF_VAR_ALERT_EMAIL` Actions secrets, gitignored tfvars | Personal data in a public repo        |
| Terraform state             | GCS bucket in the project                                                        | Holds resource attributes             |

## Trust boundaries and entry points

| Entry point                                     | Who can reach it                                     | Authn/authz                                                                                       | Notes                                                         |
| ----------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Cloud Run `control-plane` (`*.run.app`)         | Internet (`INGRESS_TRAFFIC_ALL`, invoker IAM off)    | `/health`, `/config.json`, SPA: public. `/api/*`: Firebase ID token + email allow-list (ADR-0010) | Caps: max 2 instances, concurrency 80, timeout 60s (ADR-0028) |
| Firebase Auth (Google sign-in)                  | Internet                                             | Google account; authorized domains                                                                | Web API key is public by design                               |
| GitHub Actions on `pull_request`                | Anyone who can push a branch here (Andy, his agents) | Workflows run the PR's own workflow files                                                         | Forks get no secrets; agents skip forks                       |
| GitHub Actions on `push: main`                  | Whoever merges to `main` (Andy)                      | WIF: `deployer` bound to `refs/heads/main` only                                                   | Deploys the image                                             |
| GitHub Actions `schedule` / `workflow_dispatch` | Andy (dispatch); GitHub (schedule)                   | Repo write access                                                                                 | System security review, Terraform plan                        |
| Security-review agent                           | PR diff (untrusted)                                  | Read/Glob/Grep only; token `contents: read`, `pull-requests: write`                               | Rules and threat model read from the base branch              |
| System security-review agent                    | Whole repo + drift summary                           | Read/Glob/Grep + edit of this file only; job token `contents: write`, `pull-requests: write`      | Opens a PR; never merges                                      |

## Credentials and identities

| Identity / secret          | Grants                                                                                                                                                                                      | Usable from                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `tf-plan` SA (WIF)         | `roles/viewer`, `roles/iam.securityReviewer`, `roles/secretmanager.viewer` (metadata), `roles/serviceusage.serviceUsageConsumer`, `roles/firebaserules.viewer`; state bucket `objectViewer` | Any workflow run in this repo (any branch, any event)  |
| `deployer` SA (WIF)        | `run.developer` on the service, `artifactregistry.writer` on the repo, `actAs` runtime SA                                                                                                   | Workflows on `refs/heads/main` only                    |
| `control-plane-runtime` SA | `logging.logWriter`, `cloudtrace.agent`, `firebaseauth.viewer`, `datastore.user`                                                                                                            | The Cloud Run service                                  |
| `CLAUDE_CODE_OAUTH_TOKEN`  | Andy's Claude subscription                                                                                                                                                                  | Any same-repo workflow run (not forks, not Dependabot) |
| `GITHUB_TOKEN`             | Per-job, least privilege (`permissions:` in each workflow)                                                                                                                                  | That job                                               |

## Mitigations in place

- Public-repo secret hygiene: TruffleHog on every PR and push, GitHub push protection, gitignored tfvars/state (ADR-0015).
- Per-PR scans: CodeQL (TypeScript + Actions), dependency review (fails on high), Trivy Terraform misconfig scan (fails on high), actionlint (ADR-0030: Security review automation choices).
- Per-PR security-review agent; high/critical fail the check unless `security-accepted` (removed on every push).
- All actions pinned to commit SHAs; Dependabot (npm, Actions, Terraform) with a 7-day cooldown.
- Cost caps on Cloud Run, $25/month budget alerts, usage alerts (ADR-0028, ADR-0029).
- Terraform applies only from Andy's machine; CI identity is read-only (ADR-0011).

## Open risks

| ID  | Risk                                                                                                                                                                                       | Severity | Status    | Owner | Mitigation / next step                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `tf-plan` has basic Viewer (likely reads Firestore documents and most logs) and federates from **any** branch and event in this repo. A workflow on a pushed branch can read data with it. | medium   | open      | Andy  | Replace `roles/viewer` with the narrow viewer roles plan needs; restrict the WIF binding (e.g. `assertion.event_name` in `pull_request`, `workflow_dispatch`, `schedule`).              |
| R2  | Repo secrets (`CLAUDE_CODE_OAUTH_TOKEN`, `TF_VAR_*`) are readable by any workflow on a same-repo branch, including one an agent wrote.                                                     | medium   | open      | Andy  | Only Andy and his agents push here; move secrets to GitHub environments with branch rules when agents push branches (M1.6: Claude Code executor).                                       |
| R3  | Public Cloud Run URL invites cost abuse (request floods, egress).                                                                                                                          | medium   | open      | Andy  | Caps + budget + usage alerts in place; kill switch in M1.14: Cost kill switch.                                                                                                          |
| R4  | Firebase web API key is public by design; abuse of Identity Toolkit endpoints (sign-up spam, quota).                                                                                       | low      | open      | Andy  | Allow-list blocks access; check the key's API restrictions and disable email/password sign-up.                                                                                          |
| R5  | A PR runs its own workflow files, so it can weaken its own security review (edit the workflow or gate script).                                                                             | medium   | open      | Andy  | Procedure and threat model come from the base branch; Andy reviews `.github/`, `scripts/security-review-gate.mjs` and `platform/procedures/` changes. Add a ruleset / CODEOWNERS later. |
| R6  | Prompt injection in a diff could make the reviewer under-report.                                                                                                                           | medium   | open      | Andy  | Read-only tools, structured output, deterministic scans, Andy merges every PR; different-vendor reviewer from M2: Add Jules + model routing.                                            |
| R7  | Third-party GitHub Action supply chain (e.g. the March 2026 `trivy-action` tag hijack).                                                                                                    | low      | mitigated | Andy  | SHA pins, Dependabot cooldown; release binaries are checksum-verified.                                                                                                                  |
| R8  | Reviewer runs on Andy's subscription; a burst of pushes burns quota.                                                                                                                       | low      | mitigated | Andy  | One run per PR at a time (cancel-in-progress), `--max-turns`, step timeouts; neutral check when quota runs out.                                                                         |
