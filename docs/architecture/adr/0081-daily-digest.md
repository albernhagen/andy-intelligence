---
status: accepted
date: 2026-11-09
---

# 0081 — Daily digest, computed on read

AI-70: Daily digest. ADR-0060 (M2: Self-hosting) asks for a digest that "leads with exceptions (rework, reverts, blocked, waiting on Andy), then what merged and what it cost", so Andy can trust the loop without reading every PR. The coordinator writes one by hand today (`docs/build-log/2026-11-09-digest-m2.md`).

## Decision

| Topic       | Decision                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Order       | Exceptions, then merged, then in progress (runs in flight, Ready for review), then totals (runs ended, failed, estimated cost, quota delta, merged). An empty section is left out; when every section is empty the digest is one line: "nothing happened".               |
| Exceptions  | Failed runs (with the error, and whether retried), PRs closed unmerged, rework and reverts (the run's `outcome`), PRs a review agent blocked, tickets waiting on Andy or blocked (the story panel's status line), dispatch idle (paused or a cap), quota at the reserve. |
| Merged      | Ticket, PR, who merged (`gate` when the control plane's merge attempt on that run succeeded, else `andy`), the gate's verdict and reasons, the ticket's estimated cost (AI-67).                                                                                          |
| Window      | `hours` (default 24, 1–168) back from `until` (default now). Waiting, blocked, dispatch and quota are current state, so they appear only when the window reaches now; a past window shows only what happened in it.                                                      |
| Computation | On every read, by the pure `buildDigest` in `packages/domain/src/digest.ts`. No scheduler, no stored snapshot, no new infrastructure. "Since the previous view" is not built: it would need stored per-viewer state.                                                     |
| Reads       | Bounded (ADR-0028): project, tickets, open questions, active runs, runs ended in the window (`RunStore.listEndedBetween`, at most 500), quota; plus history and runs for at most 50 tickets that changed in the window or wait in review. Past 50, `truncated`.          |
| Surfaces    | `GET /api/projects/{id}/digest`, MCP `digest` (read-only; plain text first, the structure as `structuredContent`), page `/p/<project>/digest` linked from the header in a project scope. All return the same `Digest` schema.                                            |

## Consequences

- Good: no cost while nobody looks; one builder for the page, API and MCP; no schema change (`SCHEMA_VERSION` unchanged).
- Bad: "who merged" is inferred from the run's merge attempt; a merge through the GitHub UI after a failed attempt reads as Andy. `listEndedBetween` uses a range on `endedAt` across projects and filters the project in memory (an equality plus a range would need a composite index); fine for one user's few projects, revisit in M5: Multi-project in parallel.
- A merged PR is found by its `pr_linked` event on a ticket whose `updatedAt` is in the window; a PR linked to a ticket that didn't change (e.g. already Done) is missed.
