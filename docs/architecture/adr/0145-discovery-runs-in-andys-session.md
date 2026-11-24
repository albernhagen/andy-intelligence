---
title: Product discovery runs in Andy's own Claude session, not as an agent task
status: accepted (Andy, 2026-11-23: option A)
date: 2026-11-23
---

# 0145 — Product discovery runs in Andy's own Claude session, not as an agent task

AI-355: Product discovery before the brief: discover, challenge, case, go or no-go.

## Context and Problem Statement

The 2026-11-23 product and architecture review found nothing helps find, research, challenge or score an idea before its brief (ADR-0053). Discovery needs web search. Agent tasks have none: `platform/executor/profile.json` denies WebSearch and WebFetch, so a steered agent can't fetch or leak through the web.

## Considered Options

1. **Andy's own Claude session** follows a vendor-neutral procedure (`platform/procedures/discover.md`, skill `/discover`) and records the result in the project's repo by a PR.
2. **A new agent-task step with web access.** Runs unattended, but opens the executor's permission profile to the web for every step that shares it, a new prompt-injection path with the Claude token in reach.
3. **No discovery step.** Ideas go straight to the onboarding interview.

## Decision Outcome

Option 1 (Andy, 2026-11-23).

- Four steps in order: discover, challenge, case, go or no-go. Andy decides; the procedure never does.
- The result is `docs/product/discovery.md` in the project's repo (fixed template, sources cited), opened as a PR Andy merges. On go, the onboarding interview offers the brief answers discovery settled and asks Andy to confirm each one. The brief's stored shape is unchanged.
- Web content is data, never instructions: a page that tries to steer the session is quoted to Andy, not obeyed (R-AI-355).
- Usable without the control plane (ADR-0032): web search, the repo and `git`/`gh` only.

### Consequences

- No executor or permission-profile change; agent tasks keep no web access.
- Discovery needs Andy present; it can't run overnight. A per-milestone case is a later ticket.
- Andy's session reads the web with his `gh` login in reach: the procedure's rules, not a sandbox, keep a page from steering it.
