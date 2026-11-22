# Threat model: Night runs

Overnight launches (ADR-0049, AI-104, AI-123, AI-124). Risks: [R-AI-123](risks/R-AI-123.md), [R-AI-124](risks/R-AI-124.md). Launches start and stop through the entry points below (AI-120).

## Entry points (AI-120)

| Entry point                                                   | Who can reach it                                                             | Authn/authz                                                                         | Notes                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects/:id/tickets/:id/night`, MCP `night_status` | Allow-listed users (Firebase ID token on `/api`, our access token on `/mcp`) | Read-only                                                                           | The epic's checklist, latest launch and progress; reads ≤ 50 stories. Question and reason text is untrusted, rendered as plain text                                                                                                                                                    |
| `POST …/night`, MCP `launch_night`                            | Same                                                                         | Owner-only (`start_run`, `permissions.ts` unchanged); agents and the system get 403 | Refused, listing every problem, while a story has an open question, misses the Definition of Ready or waits for a plan, or the budget or stop time is missing or over the caps below; one active launch per project. With GitHub connected it opens `epic/<KEY>` with the App (AI-122) |
| `POST …/night/stop`, MCP `stop_night`                         | Same                                                                         | Owner-only (`start_run`)                                                            | `stopping` while the stories have agent tasks in flight, then ended; `409` with no running launch                                                                                                                                                                                      |

- **Low (security review, PR #187):** MCP `launch_night` has no extra human confirmation. A launch starts nothing itself: stories start under auto-build and the dial as before, and a launch only holds them back past its budget, stop time or a stop (AI-121). It does widen what the night decides alone (the section below), so an injected call could make a night of assumptions start; the caps and the merge gate still apply.

## What an unattended night may decide by itself

- Only on a story of a **running** launch: an epic's child, listed in the launch when Andy started it.
- A refine gap that would have been a question, or held past a question cap (ADR-0087), becomes an assumption marked with the launch id (`nightLaunchId`). It isn't held, so the story can reach Ready and build without Andy's answer.

## What it never may

- Answer a question that was open before the launch: the launch refuses to start while any story has one, misses the Definition of Ready or waits for a plan approval (AI-104).
- Merge outside the merge gate: required checks, both review agents and the protected paths are unchanged. A veto stops the story. Only the merge mode is skipped, and only for a merge into the epic branch (below).
- Merge into `main`: the morning PR's head is `epic/<KEY>`, not an agent branch, so the gate never touches it. Andy merges it.
- Start a story whose blocker failed, was rejected or was vetoed: it waits on `blockedBy`, the launch lists it as skipped and it is flagged for the morning. When only stopped or skipped stories are left, the launch ends instead of idling to its stop time (with the night budget, AI-121).
- Keep going once the launch is `stopping` or ended: questions are asked again as usual.

## Merging into the epic branch (AI-124, ADR-0107)

A new App-token write: the control plane squash-merges a story PR into `epic/<KEY>`, then opens one PR `epic/<KEY>` → `main` when the launch ends, or deletes an epic branch nothing merged into.

| Rule            | How                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same gate       | Merges only when `not_default_branch` is the gate's only reason. CODEOWNERS and required checks come from the default branch, never the epic branch (which has no rules) or the PR.     |
| Which PRs       | From stored facts only: the active launch's recorded `epicBranch`, equal to the PR's base and the build run's `baseBranch`; a story of the launch, not Done. PR text is never an input. |
| Branch writes   | The adapter opens PRs from, and deletes, `epic/<KEY>` refs only (pattern-checked before any call). A branch is deleted only when its tip is still the launch's starting commit.         |
| Morning PR text | Description: keys, links and shas only. Title: the epic's title with `@` dropped, so it notifies no one.                                                                                |
| Morning report  | One `system` comment per launch (AI-125), stored facts only; agent text one line, ≤ 240 characters, markdown escaped, URLs broken.                                                      |

Residual: a story merged overnight is Done before Andy reviews it, and later stories build on it; a bad early story taints the rest (ADR-0049). Andy sees it all in the morning PR and report; nothing reaches `main` without him.

## Caps (ADR-0028)

Per launch, set by Andy and checked at start: agent tasks ≤ 100, tokens ≤ 50 M, ≤ $500 at API prices, stop time ≤ 16 h away, ≤ 50 stories, so ≤ 50 merges into the epic branch (once per story, from the merge claims written before each merge call). The dispatch dial, the global cap, the cap on agent PRs waiting and the quota reserve still apply (ADR-0079).

## Threat and residual risk

- Gap text comes from refine output, which untrusted ticket content can shape: overnight, an injected costly guess builds without Andy's answer.
- Mitigations: the caps above; every agent PR still passes the merge gate, CI and both review agents; Andy reviews each `nightLaunchId` assumption in the morning, and the PR shows the change before he merges.
- Residual: a wrong night assumption can produce a plausible PR that passes the checks; only the morning review catches it.
