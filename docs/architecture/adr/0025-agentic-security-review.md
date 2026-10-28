---
status: accepted
date: 2026-10-23
---

# 0025 — Agentic security review: every PR, and the whole system over time

## Context and Problem Statement

Agents write most of the code, the repos are public, and the system holds credentials for GitHub, GCP, and model providers. Human review alone won't catch everything, and risks also come from how pieces combine over time (IAM drift, new entry points), not just single diffs. Andy wants security checked on every PR and across the system as it evolves.

## Decision Outcome

Two layers, on this repo first (slice M1.10) and on every managed project from M4: Second project + epics + story board.

**1. Per PR**

| Check                                                                                                                                                                                                                                             | Kind          | Blocks merge                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| Secret scan (TruffleHog), CodeQL (TypeScript + Actions), dependency review, Terraform misconfig scan, workflow linter                                                                                                                             | Deterministic | Yes, on high/critical                                                                            |
| Security reviewer agent: reviews the diff against the threat model and ADRs (authn/authz, IAM, secrets, injection incl. prompt injection, workflow permissions, public-repo exposure, cost abuse) and posts one comment with findings by severity | Agentic       | Yes, on high/critical — unless Andy adds the `security-accepted` label and records why in the PR |

Agent guardrails: runs on `pull_request` from same-repo branches only (never `pull_request_target`, never forks); token scopes `contents: read`, `pull-requests: write`; read-only tools (no shell, no network); the diff and PR text are untrusted data. If the agent can't run (no quota, outage), its check reports neutral and Andy decides. In M1 the reviewer is Claude in a separate read-only session; from M2/M3 a different vendor than the implementer reviews (§4.5).

All third-party actions are pinned to commit SHAs, updated by Dependabot.

**2. System evolution**

- `docs/security/threat-model.md` is a living doc: assets, trust boundaries, entry points, threats, mitigations, and an open-risks table (severity, status, owner). A PR that adds or changes a trust boundary updates it (ADR-0022).
- A **system security review agent** reads the whole repo, threat model, ADRs, Terraform IAM, and a `terraform plan` drift summary, then opens a PR updating the threat model with new findings.
- Runs at the end of every milestone and weekly when anything merged since the last review; also on demand.
- **Milestone gate:** a milestone isn't done while a high/critical finding is open, unless Andy accepts the risk in the threat model.
- Once tickets exist, high/critical findings also become tickets flagged Needs-you.

### Consequences

- Good: every change gets a security pass; slow-building risks get caught; findings are tracked in one place.
- Bad: uses subscription quota per PR push; LLM findings can be noisy (mitigated by the override label and tuning the reviewer prompt); the reviewer token is a repo secret readable by any same-repo branch workflow (recorded as an open risk).
