---
title: Routing config, route resolver and Jules as a second executor
status: proposed
date: 2026-11-21
amends: 0050 (Claude-only through M6 ends with M9), 0062 (tier → route comes from config)
---

# 0128 — Routing config, route resolver and Jules as a second executor

AI-228: M9.1: Routing and Jules design, for M9: Add Jules + model routing (epic AI-225, slice table `docs/architecture/m9-slices.md`). Andy answered both questions below on 2026-11-21: (a) for each.

## Context and Problem Statement

Today `domain/tiers.ts` hard-codes two routes (fast = Claude Sonnet, strong = Claude Opus) and only the GitHub Actions executor exists, so the `Executor` port is still a draft (ADR-0006). M9 adds a second agent (Jules on the google-sub subscription), lets Andy edit tiers and routes, enforces which harness works with which provider, and counts google-sub quota. routing-and-policy.md lists the entities and rules but not how they are stored or chosen.

## Decision Outcome

| Topic              | Decision                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config             | One `RoutingConfig` document: `providers` (per provider: enabled, reserve, warn and pause percentages, a daily task limit for google-sub), `tiers` (per tier: up to 5 ordered routes), `steps` (per step: a tier, or "by size"). Stored behind a `RoutingConfigStore` port: one global document, at most one per project. |
| Default            | `DEFAULT_ROUTING` reproduces today: fast = claude-code/claude-sub/sonnet, strong = claude-code/claude-sub/opus; google-sub and openrouter disabled. Nothing routes differently until Andy edits the config.                                                                                                               |
| Narrowing          | Global is the ceiling. A project config can disable providers, raise reserves and pin tiers, never enable what global disables or add a route global lacks. Checked on save and again when resolving.                                                                                                                     |
| Compatibility      | `claude-code` only with `claude-sub` and a Claude model; `jules` only with `google-sub`; `opencode` and `direct` only with `openrouter`. One pure rule (`routeProblem`) used on save and at resolve time.                                                                                                                 |
| Resolver           | Pure: for a step and tier, the first route that is enabled and compatible, plus why each earlier route was skipped. A compatible `overrides.modelPin` wins. No usable route refuses the agent task with a reason on the ticket. No quota-aware fallback: that stays in M10: Paid models + spend caps.                     |
| Edits              | Signed-in, owner-only routes and MCP tools; every save is a `ConfigChange` (audited, revertable). Settings → Models shows the result.                                                                                                                                                                                     |
| Jules adapter      | A second `Executor` in a new package, `packages/jules`, beside `packages/github`: REST over `fetch`, no new dependency, timeouts on every call, the key from `JULES_API_KEY` (Secret Manager), off when unset. Build step only: Jules opens PRs, so refine and plan stay on Claude.                                       |
| Jules completion   | ADR-0018: Jules opens its own PR; the PR webhook matches it to its run by a run marker (and branch, per the spike) and only when the PR's author is the Jules app; the run finishes and the ticket moves as for any agent PR. No PR by the deadline fails the run through the watchdog.                                   |
| google-sub quota   | Jules reports no usage, so a reading is the Jules tasks the control plane started in the window divided by the plan's daily limit (window from the spike). Unknown without a limit. Reserve 20%, warn 70%, pause 80% (routing-and-policy.md).                                                                             |
| Contract           | The `Executor` port is frozen when the GitHub Actions executor and the Jules adapter both pass its contract suite in CI (ADR-0006).                                                                                                                                                                                       |
| Cross-model review | Not decided here: AI-241: M9.13: Cross-model review carries its own question.                                                                                                                                                                                                                                             |

### Questions (answered)

**Q2:** Should Jules take work only when a ticket or epic opts in? **Answered: (a), Andy, 2026-11-21.**
Context: Jules's quality on this codebase is unknown, and its PRs go through the same gate and reviews as Claude's.

- (a) Opt-in only: a ticket or epic sets `overrides.assignee: jules` or pins a Jules route. Nothing changes until Andy chooses; slowest to learn.
- (b) A tier: a new `cheap` tier routed to Jules for S chores. More Jules work at once; a bad route affects many tickets.
- (c) Fallback when Claude is paused on quota: moves M10's fallback into M9, about one M slice.
  Recommendation: (a) for two weeks, then revisit (b).

**Q4:** Should a project be able to turn Jules on for itself, or only Andy, globally? **Answered: (a), Andy, 2026-11-21.**
Context: under the narrowing rule a project can switch a provider off but not on. This matters once project members exist (M8: Project members).

- (a) Global only: matches the narrowing rule; no extra code.
- (b) Per-project opt-in: google-sub off globally by default and on per project; one more setting and an exception to the rule.
  Recommendation: (a).

### Layers (terminology)

Who sets a ticket's worker, tier and route, first match wins (AI-116: M4.5: Epic overrides cascade and overrides editor, `packages/domain/src/overrides.ts`; unchanged here):

| Layer           | What it is                                                                     |
| --------------- | ------------------------------------------------------------------------------ |
| Ticket override | Set on the ticket itself.                                                      |
| Epic override   | Set on its epic; its stories inherit. A milestone is an epic titled `M<N>: …`. |
| Project default | The project's routing config; can only narrow global.                          |
| Global          | Andy's routing config: the ceiling.                                            |

The UI must show which layer set a ticket's worker, tier and route: AI-282: M9: Show which layer set a ticket's worker, tier and route.

### Consequences

- Good: routes become data, so trying Jules or a new model is a settings change with an audit trail; the default changes nothing; the second adapter finally tests the `Executor` contract.
- Bad: one more stored document read at every dispatch (cached per dispatch); Jules's API is young (alpha), so the adapter may need changes; until M10, a paused provider stops its tier instead of falling back.
