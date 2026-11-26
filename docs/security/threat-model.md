---
version: 9
last_reviewed: 2026-11-09
reviewed_by: system security review
---

# Threat model — andy-intelligence

Living doc (ADR-0025). Update it with any trust-boundary, entry-point, credential or IAM change; the system security review (`platform/procedures/threat-model.md`) updates it weekly and at each milestone end.

**Milestone gate:** a milestone isn't done while a `high` or `critical` risk (below) is `open`, unless Andy marks it `accepted` with a reason.

Severity: `critical` (exploitable now, big blast radius) · `high` (exploitable with modest effort, or big blast radius) · `medium` (needs an unlikely precondition) · `low` (defense in depth).

## Assets

| Asset                             | Where                                                                                                                                                  | Why it matters                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tickets, runs, questions          | Firestore (default DB, `andy-intelligence-512400`); daily backups kept 7 days                                                                          | Only copy of work tracking (ADR-0017)                                                                                                           |
| Webhook records                   | Firestore `codeHostEvents` (normalized, no raw payload; TTL 30 days)                                                                                   | PR deliveries move tickets; later, Run completion                                                                                               |
| GCP project and billing           | `andy-intelligence-512400`                                                                                                                             | Cost abuse, data access                                                                                                                         |
| Repo `main` branch                | GitHub `albernhagen/andy-intelligence` (public)                                                                                                        | Push to `main` deploys to Cloud Run                                                                                                             |
| Claude subscription               | `CLAUDE_CODE_OAUTH_TOKEN` Actions secret                                                                                                               | Quota theft; tied to Andy's account                                                                                                             |
| MCP OAuth grants                  | Firestore `oauthGrants` (SHA-256 hashes only; TTL-deleted)                                                                                             | Hashes can't be replayed; deleting them revokes MCP access (ADR-0039)                                                                           |
| GitHub App key and webhook secret | Secret Manager (`github-app-private-key`, `github-webhook-secret`), written by the API's setup flow; App IDs in Firestore `config/codeHost` (ADR-0043) | The key mints tokens with contents + pull requests write on every repo the App is installed on; the webhook secret lets anyone forge deliveries |
| Allow-list and alert emails       | `TF_VAR_ALLOWED_EMAILS`, `TF_VAR_ALERT_EMAIL` Actions secrets, gitignored tfvars                                                                       | Personal data in a public repo                                                                                                                  |
| DNS zone `andybernhagen.com`      | Cloudflare (Andy's account); records for the control plane in `infra/dns` (ADR-0044)                                                                   | Controls where `ai.andybernhagen.com` points, so who receives sign-ins, MCP tokens, webhooks and Actions OIDC tokens (R20)                      |
| Terraform state                   | GCS bucket in the project                                                                                                                              | Holds resource attributes                                                                                                                       |

## Area detail

Trust boundaries, entry points and credentials, moved by area (ADR-0046). PRs that change an area update its file; the weekly system review edits only this file and the risk files. The per-PR security review reads this file and the area files from the base branch.

| Area                           | File                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| Entry points and credentials   | [`entry-points-and-credentials.md`](entry-points-and-credentials.md)     |
| Agents and executors           | [`agents-and-executors.md`](agents-and-executors.md)                     |
| UI and MCP                     | [`ui-and-mcp.md`](ui-and-mcp.md)                                         |
| Infrastructure                 | [`infrastructure.md`](infrastructure.md)                                 |
| Night runs                     | [`night-runs.md`](night-runs.md)                                         |
| Deployment reports             | [`deployments.md`](deployments.md)                                       |
| Releases read                  | [`releases.md`](releases.md)                                             |
| Deploy caller in managed repos | [`deploy-caller.md`](deploy-caller.md)                                   |
| Project context in prompts     | [`project-context.md`](project-context.md)                               |
| Review pipeline                | [`review-pipeline.md`](review-pipeline.md)                               |
| Web Push                       | [`push.md`](push.md)                                                     |
| Project agent tasks            | [`project-tasks.md`](project-tasks.md)                                   |
| Digest summary                 | [`digest-summary.md`](digest-summary.md)                                 |
| Model gateway (OpenRouter)     | [`model-gateway.md`](model-gateway.md)                                   |
| Project settings               | [`project-settings.md`](project-settings.md)                             |
| Project access                 | [`project-access.md`](project-access.md)                                 |
| Paid model spend               | [`spend.md`](spend.md)                                                   |
| Coordinator and cloud sessions | [`coordinator-and-cloud-sessions.md`](coordinator-and-cloud-sessions.md) |

## Mitigations in place

- Public-repo secret hygiene: TruffleHog on every PR and push, GitHub push protection, gitignored tfvars/state (ADR-0015).
- Per-PR scans (CodeQL, dependency review, Trivy, actionlint; ADR-0030) and security-review agent. A review that should run and doesn't fails its check; a re-sync merge keeps a verdict only when the PR's diff is unchanged (ADR-0140, R-AI-346). Agent PRs get both reviews: the App may start them on `agent/*` only (ADR-0141, R-AI-348).
- All actions pinned to commit SHAs; Dependabot (npm, Actions, Terraform) with a 7-day cooldown; npm patches and stable minors auto-merge after all required checks, never deploying on their own (ADR-0042); a coordinator merges clean PRs; Andy merges what judges a PR and three more kinds (ADR-0124, R23), refused in code by the gate and `merge_pr` (`KEPT_PATHS`); GitHub's code-owner review does not enforce it here (AI-380).
- Project baseline (ADR-0031, ADR-0038): declared in `platform/baseline/github/`; `check` shows drift.
- Cloud Run caps, $25/month budget, usage alerts (ADR-0028, ADR-0029).
- Terraform applies only from Andy's machine (ADR-0011).
- GitHub App setup from the UI (ADR-0043): App credentials go from GitHub straight to Secret Manager; CI gets repo tokens only through the OIDC-checked endpoint.
- GitHub webhooks (ADR-0041): HMAC before any parse or store; normalized, capped records only.
- SPA: ticket text is untrusted (partly agent-written). Descriptions, comments, questions: pinned `react-markdown`, no `rehype-raw` (HTML shows as text), no image loads, only http(s)/mailto links (new tab, `noreferrer`, host shown; AI-29). ID token only to same-origin `/api/*`.

## Risks

One file per risk in [`risks/`](risks/), named by its id: `R<n>`, or `R-<KEY>` (`R-<KEY>-2` for a second) for a risk a ticket adds. Frontmatter: `id`, `severity`, `status` (`open`, `mitigated`, `accepted`, `closed`), `owner`. Body: a `**Risk:**` paragraph, then `**Mitigation / next step:**`. Never delete one: a closed risk keeps its file with `status: closed`.

- Register as a table: `pnpm risks` (open first, then closed). `pnpm test` fails on a malformed file or a reused id.
- Without a shell (read-only agents), Grep in `docs/security/risks/`: `^(severity|status):` lists every risk's severity and status (the file name is the id); `^status: open` lists the open ones; `^\*\*Risk:\*\*` gives each risk's text, one line each.
