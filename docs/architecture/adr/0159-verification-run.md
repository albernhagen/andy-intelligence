---
title: A verify task after each first-environment deploy moves Verifying tickets; it may only read the repo and fetch the deployed host
status: proposed
date: 2026-11-26
amends: 0114 (the Verifying stage gets its exit), 0040 (a step whose rules name a runtime host)
---

# 0159 — Verification run

AI-188: M6.7: Verification run. ADR-0114 added the Verifying stage (AI-181: M6.5) and the verify procedure (AI-182: M6.6); nothing moved a ticket out of the stage, so `VERIFYING_SWITCH` stayed off. Andy approved the plan on 2026-11-26: read-only web fetches for now, and the switch on in this ticket's PR.

## Context and Problem Statement

A merge in a deploying project now waits in Verifying. Something has to check the deployed app against the tickets it shipped and move them: pass → Done, fail → In progress with Needs-you. The check runs an agent against content the agent doesn't control (the deployed app), so it is a new place untrusted text meets a model.

## Considered Options

1. **Read-only tools plus WebFetch of the deployed host only.** No shell: the agent can read the repo at the deployed commit and fetch pages of the deployment, nothing else.
2. **Bash in the build sandbox, network to the deployed host and the registry,** so the project's e2e tests run against the URL. Needs dependencies installed before the agent and a runtime network allowlist in the most sensitive workflow.
3. **No agent: run the project's e2e tests in the deploy workflow.** Checks only what tests cover; acceptance criteria aren't read at all.

## Decision Outcome

Option 1 now; option 2 is a later ticket.

| Rule           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| When           | A `deploy` (not promote or rollback) to the project's first environment (`dev` for `dev-and-prod`, `prod` for `prod-only`) reports its finish over the deploy callback (ADR-0019).                                                                                                                                                                                                                                                                                 |
| Which tickets  | Tickets in Verifying whose merge commit (recorded from the `pull_request` webhook) the deployed commit contains (`CodeHost.headContains`), at most 50, oldest first, and as many as fit the prompt. A ticket without a recorded merge commit is left for the 2-hour check.                                                                                                                                                                                         |
| One task       | `RunService.requestVerify`: no ticket on the run, the `verify` step's route (fast tier), 30 turns, 25-minute deadline (the procedure stops at 20). One verify task per deployment and per project in flight; counts against the project dial, the global cap, pause, quota reserve and spend gate like any agent task (ADR-0079).                                                                                                                                  |
| Hold           | A refused start leaves the deployment's `verification` as `waiting`. When any agent task ends, each deploying project's newest first-environment deploy that waits tries again; the newest contains every older merge, so older waits are superseded.                                                                                                                                                                                                              |
| Per-ticket cap | A ticket already in 3 verify tasks since it last entered Verifying is left out and flagged Needs-you once. A task that ends without a verdict (deadline, turns, rejected verdict) puts its deployment back to `waiting`, so the next retry starts another; this cap bounds it.                                                                                                                                                                                     |
| Verdict        | Checked against `VerifyVerdict` and the task's own ticket list. Pass → Done; fail → In progress, Needs-you and a comment with the failed criteria and evidence, labelled model-written. A malformed or foreign verdict fails the run and moves nothing. A ticket moved since the task started is left alone.                                                                                                                                                       |
| Failed deploy  | The deployment's contained Verifying tickets go to In progress with Needs-you and a comment; no task starts.                                                                                                                                                                                                                                                                                                                                                       |
| Executor       | The cloud executor only (the local runner refuses `verify`). Its context check requires no ticket, no branch, at most 30 turns and an `https` URL whose host is a plain DNS name, then checks out the deployed commit. Managed settings and flags allow Read, Glob, Grep and `WebFetch(domain:<host>)`; Bash, Edit, Write and WebSearch are denied. Hosts with a private-network suffix (`.internal`, `.local`, `.lan`, `.home.arpa` and similar) are refused too. |
| Switch         | `VERIFYING_SWITCH` is `true` from this PR. Andy turns it on by merging it (high risk: kept paths); turning it off is a one-line revert (runbook `verification.md`).                                                                                                                                                                                                                                                                                                |

### Consequences

- Good: Verifying exits on a real signal; prod stays read-only by construction (WebFetch only sends `GET`, and there is no shell).
- Good: no new credential, workflow permission or infrastructure; the deploy callback already proves the caller.
- Bad: no e2e tests run yet, so `tests` is always empty and criteria that need a browser are `skipped` (which passes the ticket, by Andy's rule). Option 2 closes that.
- Bad: WebFetch hands the page to a small model that summarizes it, so evidence is a summary, not raw bytes.
