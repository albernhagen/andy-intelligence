---
status: accepted
date: 2026-11-03
---

# 0047 — Coordinating parallel work: deterministic supervisor, no LLM parent agent; building andy-intelligence with itself

Decided by Andy, 2026-11-03.

## Context and Problem Statement

Andy runs many agents in parallel, and will across onboarded projects (M2: Multi-project in parallel). Should the system have an LLM "parent" agent supervising child agents?

The control plane already supervises deterministically (principle 1: LLMs decide; deterministic systems hold state): dependency release, quota/budget-aware dispatch, a watchdog per run, one retry then Needs-you, caps. Epic refinement is the LLM step that splits work and orders it.

What went wrong on 2026-11-03 with 2–4 parallel sessions was **collisions**, not supervision: every merge left other PRs conflicting; ADR numbers, threat-model risk IDs and the ARCHITECTURE revision were claimed twice; PRs fell behind `main`; merge order had to be chosen by hand; sessions didn't know what siblings were changing. A person (or the building session) fixed each by hand.

## Decision Outcome

No LLM parent agent. The control plane stays the supervisor and gains collision handling, all in **M2: Multi-project in parallel**:

| Gap                                        | Decision                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two runs edit the same files               | **Conflict-aware dispatch:** the plan step (M1.18: Plan step) records the files a ticket expects to touch. The dispatcher doesn't start a ticket whose files overlap an in-flight one in the same repo; it waits. |
| Open PRs fall behind `main`                | **Sync runs:** when `main` moves, each open agent PR in that repo gets a short run: merge `main`, resolve conflicts, re-run the gate, push. Unresolvable → Needs-you. Capped like any run (ADR-0028).             |
| Merges race; checks pass on a stale base   | **Merge queue** per repo, entered with the GitHub App's token (`GITHUB_TOKEN` can't add to a queue). Lands with rule-based auto-merge (M6: Dev → prod releases); until then Andy merges in queue order.           |
| Shared counters in docs collide            | **Collision-free IDs:** ADR numbers and threat-model risk IDs are allocated by the control plane at merge time, or carry the ticket key (e.g. `R-AI-42`); the ARCHITECTURE revision becomes date + PR number.     |
| Agents don't see siblings' work            | **In-flight view:** an MCP/API read tool lists in-flight runs with branch and touched files, scoped to the project, so a plan can avoid or sequence around them.                                                  |
| Systems spanning repos (e.g. API + client) | **Cross-project dependencies:** "blocked by" links across projects; the dispatcher respects them.                                                                                                                 |
| More PRs than Andy can review              | Already decided: dispatch also capped by PRs waiting for Andy (ADR-0040).                                                                                                                                         |

The epic-level LLM step (split, order waves, re-plan as stories unblock, §4.4) decides; the dispatcher, queue and sync runs carry it out.

**Building andy-intelligence with itself** (project `AI`, registered in M1.5: GitHub App + project registration), in phases as capabilities land:

| Phase                    | When                                                                    | What moves into the control plane                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1. Track                 | Now (tickets, inbox, UI and MCP tools are merged)                       | Remaining slices become tickets in project `AI`, created and answered from Claude desktop; `docs/build-log.md` shrinks to history. |
| 2. Build small work      | M1: First end-to-end flow done (M1.8: Build + gate)                     | S tickets for this repo run end to end: refine → plan → PR → reviews → Andy merges.                                                |
| 3. Default for most work | M2: Multi-project in parallel done (sync runs, conflict-aware dispatch) | Parallel waves run through the control plane instead of hand-run sessions.                                                         |

Interactive sessions (Claude Code + the devkit, ADR-0032) stay for trust-boundary work (auth, IAM, Terraform, workflows, the review gates) and anything that could break the deploy: an agent changing the system that runs it could weaken its own checks (threat model R5), and a broken control plane can't repair itself.

### Consequences

- Good: parallel work scales without a person resolving conflicts; state stays in Firestore, not in an agent's context; every coordination decision is auditable and testable.
- Good: andy-intelligence is its own first user, so gaps show up in daily use.
- Bad: tickets with overlapping files run one after another (less parallelism); sync runs spend quota; the touched-files list is a prediction, so a run can still conflict (the sync run handles it).
