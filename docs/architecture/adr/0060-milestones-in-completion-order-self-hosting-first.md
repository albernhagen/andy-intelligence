---
status: accepted
date: 2026-11-04
amends: 0021, 0035, 0047, 0050, 0052, 0059 (milestone numbers, order and what each milestone holds)
---

# 0060 — Milestones numbered in completion order; self-hosting comes second; every ticket sits under a milestone

Decided by Andy, 2026-11-04.

## Context and Problem Statement

Three things had drifted:

- **Orphaned work.** Tickets AI-14 to AI-20, the ticket model (ADR-0058) and the UX foundation (ADR-0059) belong to no milestone.
- **Numbers that don't match the order.** The order was M0 → M1 → M2 → M5 → M6 → M7 → M3 → M4, with "IDs keep their meaning".
- **The goal Andy cares about most has no milestone:** using andy-intelligence to build andy-intelligence, so several things finish while he is away. After that he needs to know how to start work at story and epic level, how to set the parallelism he is comfortable with, and how to read cost and rollups when he can't review every PR.

## Decision Outcome

| Topic          | Decision                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Numbering      | A milestone's number is its place in the order of completion. When the order changes, the numbers change, in a new ADR. **The title is the stable name**: always write `ID: title` (AGENTS.md), and match old documents by title.                                                    |
| Old ADRs       | Bodies are immutable and keep the numbers of their day. The mapping below reads them. (ADR-0035's earlier renumbering still applies to ADRs written before 2026-11-01.)                                                                                                              |
| No orphans     | Every milestone is an **epic ticket** in project `AI`, titled `M<N>: <title>`; every ticket's parent is its milestone's epic. A ticket with no parent is triage, not planned work. Until tickets can be re-parented (M3: New UI and MCP), `docs/build-log.md` holds the map.         |
| Slice names    | Slices that already have a name keep it as their ticket's title, even under a new milestone ("M1.9: Quota capture" sits in M2). New work is named by ticket key and title; no new slice numbers.                                                                                     |
| Starting early | Milestones close in order. A ticket from a later milestone may start early only when it depends on nothing unfinished and touches different packages. First use: the first UI ticket of M3 (design source and app shell), built beside M1 because it needs Andy's eye, not the loop. |

### Milestones

| New | Milestone                                      | Was | What it holds                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Foundations: repo, sign-in, GCP infra          | M0  | Done.                                                                                                                                                                                                                                                                                                                                       |
| M1  | First end-to-end flow: ticket → PR with Claude | M1  | Built so far, plus AI-14: PR-event moves, AI-15: Cancel and archive, AI-16: Board drag-and-drop (all merged). Left: AI-17: Split ARCHITECTURE.md; ticket model v2 (ADR-0058); **M1.8: Build + gate** (AI-3) in two tickets, 8a (dispatcher in rank order, build run, PR) then 8b (gate, auto-merge, metrics); AI-20 and the board-drop bug. |
| M2  | Self-hosting: andy-intelligence builds itself  | new | Below.                                                                                                                                                                                                                                                                                                                                      |
| M3  | New UI and MCP                                 | new | The UX foundation (ADR-0059): design source and app shell with the project picker, board v2, story panel, command palette. MCP tools to edit, comment on, list, search, reorder and re-parent tickets. AI-19: One permission function.                                                                                                      |
| M4  | Epics + story board                            | M5  | As before, with the emphasis Andy asked for: start an epic, overnight runs (ADR-0049), dashboards, cost and delivery rollups per epic and project.                                                                                                                                                                                          |
| M5  | Multi-project in parallel                      | M2  | As before (onboarding and brief, ideation, spikes, caps and dependencies across projects), minus the single-project coordination that moves to M2.                                                                                                                                                                                          |
| M6  | Dev → prod releases                            | M6  | Unchanged.                                                                                                                                                                                                                                                                                                                                  |
| M7  | Mobile                                         | M7  | Unchanged.                                                                                                                                                                                                                                                                                                                                  |
| M8  | Project members                                | new | AI-18.                                                                                                                                                                                                                                                                                                                                      |
| M9  | Add Jules + model routing                      | M3  | Unchanged.                                                                                                                                                                                                                                                                                                                                  |
| M10 | Paid models + spend caps                       | M4  | Unchanged.                                                                                                                                                                                                                                                                                                                                  |

### M2: Self-hosting

| Piece                          | What                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safe to merge itself           | A safe deploy path for the control plane (a no-traffic revision per PR, a rollback runbook), then `autoMerge` on for project `AI` (S and M, ADR-0050). Settles the build log's pending decision.                                         |
| Parallel runs                  | More than one run at a time in a project, from ADR-0047: conflict-aware dispatch using `touches` (ADR-0058), sync runs when `main` moves, collision-free IDs (ADR numbers), an in-flight view.                                           |
| Andy's controls                | One dial per project for runs at once (default 2), a global cap, a cap on PRs waiting for Andy, and a pause switch (ADR-0028).                                                                                                           |
| Away from the desk             | M1.9: Quota capture (AI-5), so dispatch pauses at the reserve; email notifications for the inbox (a `Notifier` adapter; settles a pending decision); the watchdog and retry are already built.                                           |
| Trust without reading every PR | M1.17: Agent evals v1 (AI-6); estimated cost per run, totalled per ticket; a **daily digest** that leads with exceptions (rework, reverts, blocked, waiting on Andy), then what merged and what it cost.                                 |
| Done when                      | Andy puts five tickets in Ready on project `AI`, leaves, and returns to merged PRs, a digest, and an inbox that holds only what needs him. A bad merge is rolled back with the runbook. Runs never exceed his dial or the quota reserve. |

### How Andy drives it

- **A story:** a title, from the UI or Claude desktop. Refine drafts it and asks. When ready it sits in Ready, and the dispatcher takes from the top: order is the control (ADR-0058).
- **An epic** (M4): the idea; refine splits it into stories with dependencies; Andy approves the split once and starts it. Overnight mode asks everything up front.
- **Parallelism:** the dial, the caps and the pause switch above.
- **Cost and rollups:** per run and ticket in M2, per epic and project with dashboards in M4.

### Consequences

- Good: the number says where a milestone is in line; nothing is planned outside a milestone; the system starts doing its own work two milestones earlier, and builds M3 onward itself.
- Bad: numbers in older ADRs, commits and PR titles no longer match (the title and the table above bridge it); every reorder costs a docs change; Andy's side projects (M5) move behind epics (M4): swap them in a new ADR if that proves wrong; M1.8 in two tickets means a short period where PRs open on their own but nothing merges on its own.
