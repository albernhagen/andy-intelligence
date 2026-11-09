---
status: accepted
date: 2026-11-09
amends: 0063 (one run per project), 0028 (run caps)
---

# 0079 — Dispatch caps: runs-at-once dial, global cap, cap on waiting PRs, pause

## Context and Problem Statement

ADR-0060 "Andy's controls" (M2: Self-hosting) asks for parallel runs under Andy's control. Until now a project ran one run at a time (`MAX_ACTIVE_RUNS_PER_PROJECT`) and the dispatcher stopped at 3 tickets in In progress + Ready for review (`MAX_TICKETS_IN_FLIGHT`). ADR-0028: anything that can scale or spend needs an explicit cap.

## Decision Outcome

| Control                                         | Value                                    | Where                                               |
| ----------------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| Dial: runs in flight per project (`runsAtOnce`) | default 2, 1 to 4                        | Project; `RUNS_AT_ONCE_DEFAULT`, `RUNS_AT_ONCE_MAX` |
| Global cap: runs in flight across projects      | 4                                        | `MAX_ACTIVE_RUNS_GLOBAL`                            |
| Agent PRs waiting for Andy, per project         | 5                                        | `MAX_PRS_WAITING_PER_PROJECT`                       |
| Pause (`paused`)                                | off                                      | Project                                             |
| Quota reserve                                   | a fresh reading at the pause level (80%) | `CLAUDE_SUB_THRESHOLDS`                             |

- `mayDispatch(project, counts)` (`packages/domain/src/dispatch-caps.ts`) is the one rule. It returns `start` or the idle reason, checked in this order: `paused`, `project_cap`, `global_cap`, `prs_waiting_cap`, `quota_reserve`. The build dispatcher asks it before every start.
- **Every step counts** against the dial and the global cap (refine, plan, build): each spends the same subscription quota, so "runs never exceed his dial" (ADR-0060) holds.
- **The PR cap counts runs in flight as PRs to come**, so it can't be overshot. A waiting PR is a ticket in Ready for review with a build run that opened a PR; PRs Andy opened himself don't count. It replaces `MAX_TICKETS_IN_FLIGHT`, which would have stopped a dial above 3.
- **`RunService.start` enforces the dial and the global cap too**, for starts by hand as well, and re-checks after creating the run; the oldest run wins a race. It also allows one run per ticket: above a dial of 1, two concurrent dispatches could otherwise build one ticket twice.
- **Pause stops the build and refine dispatchers.** Runs in flight finish, a start by hand still works (it is Andy's decision), and a failed run's one automatic retry still goes.
- **Quota:** only a fresh reading at `pause` stops dispatch. Stale or missing reads `unknown` and doesn't: M1.9 capture is best-effort, and a missing reading mustn't halt the system.
- **Last decision** is stored on the project (`lastDispatch`: decision and since when; also `started`, `nothing_ready`), written only when it changes, and shown on `/projects`, the board and MCP `status`. Clients can't write it.
- **Wake-ups:** a run ending, a cancel, a ticket reaching Ready, a PR leaving review and a settings change all dispatch again. A project idle on `global_cap` is woken when any other project dispatches.

### Consequences

- Good: Andy sees why nothing runs; the caps hold under concurrent starts.
- Bad: counting all projects' runs reads every project on each start and check; fine at this project count, revisit at M5: Multi-project in parallel.
- Bad: the refine dispatcher still waits for an empty project, so a long Ready queue delays auto-refine until it drains.
- Open: the reading sanity checks in `docs/runbooks/quota.md` aren't built, so a false reading from a compromised run can idle dispatch (threat model R24).
