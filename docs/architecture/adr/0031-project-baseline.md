---
status: accepted
date: 2026-10-28
---

# 0031 — Project baseline: every guardrail built here is carried to managed projects

Decided by Andy, 2026-10-28 (after M1.10: Security review automation merged).

## Context and Problem Statement

andy-intelligence is building its own quality, security, cost and scaling guardrails first: CI, local hooks (ADR-0027), security scans and review agents (ADR-0025, ADR-0030), adversarial review (ADR-0026), GCP caps and alerts (ADR-0028). The products Andy builds with the control plane need the same defaults, applied the same way every time, and kept up to date. §8 says onboarding is "template + bootstrap" but doesn't say what the template holds, how GitHub settings get there, or how fixes reach existing projects. M1: First end-to-end flow onboards the first real project (M1.5: GitHub App + project registration) before M4: Second project + epics + story board, where the template was planned.

## Decision Outcome

**Project baseline** = the versioned set of guardrails every managed repo gets. It lives in this repo; this repo is configured from it too (dogfooding), so the two can't drift.

| Kind                                                                                                                                                                 | Carried by                                                                                                                                                                                                                    | How fixes reach projects                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| CI and security workflows                                                                                                                                            | Reusable workflows in `platform/workflows/` (`workflow_call`). Each project keeps thin callers pinned to a commit SHA of this public repo. Scripts and procedures are checked out from that same pinned SHA, not from the PR. | Dependabot bumps the pin                                     |
| Repo files: `lefthook.yml`, `.claude/settings.json` + format hook, `.github/dependabot.yml`, PR template, `AGENTS.md`, threat-model seed, procedures (`docs/agent/`) | `template/`, copied at onboarding; `.andy/baseline.json` records the baseline version                                                                                                                                         | Drift check flags stale copies; an agent opens the update PR |
| GitHub repo config: `main` ruleset (required checks, code scanning rule, no force push), security & analysis settings, Actions permissions, labels                   | Declarative JSON in `platform/baseline/github/`, applied idempotently (script now, the control plane's GitHub App later); `--dry-run` prints a diff                                                                           | Re-apply; drift check                                        |
| Secrets                                                                                                                                                              | Names and how to create them only (runbook); Andy sets values                                                                                                                                                                 | —                                                            |
| GCP guardrails: budget, Cloud Run caps, usage alerts, log exclusions, kill switch                                                                                    | Terraform modules in `infra/modules/`, used by this repo and the project template                                                                                                                                             | Module version bump (M5: Dev → prod releases)                |

**Rules**

- Every slice that adds or changes a guardrail updates the baseline inventory (ARCHITECTURE §8.1) in the same PR: how it is carried, or "not yet carried" with the slice that will carry it.
- Weekly drift check (part of the system security review): each managed repo's live config vs the baseline; differences become findings.
- New slice **M1.16: Project baseline v1** builds the mechanism before the first real project's first agent build (M1.8: Build + gate depends on it). M4's UI/MCP "Add project" reuses it.

### Consequences

- Good: one place to fix a guardrail; new projects start compliant; review rules come from a pinned SHA, which also closes most of threat-model risk R5 for managed projects.
- Bad: projects depend on this public repo's workflows (pinned, so a bad change can't land silently); applying GitHub settings needs an admin credential (Andy's `gh` for now; the GitHub App needs Administration write later, a new trust boundary to model); M1 grows by one M slice.
