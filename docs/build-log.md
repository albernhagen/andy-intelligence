# Build log — status

Slice status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI (drag on the board, or Move to …), any move; cancel and archive also over MCP `cancel_ticket` / `archive_ticket`. Sessions and agents: MCP `move_ticket`, one step forward. PRs move their ticket on their own (AI-14: Tickets move on PR events): name the key in the branch, or start the PR description with the ticket link; opened → Ready for review, merged → Done, from any open stage, whoever wrote the PR (ADR-0067); closed unmerged → In progress + Needs-you. M1.8: Build + gate relies on this.
- **Slice definitions:** [`architecture/milestones.md`](architecture/milestones.md) (ARCHITECTURE §12). A ticket's body names its row.

## Milestone map (ADR-0060: Milestones in completion order)

Every ticket sits under a milestone. Milestones are epic tickets in project `AI` (AI-21: M1, AI-22: M2, AI-23: M3); until tickets can be re-parented (M3: New UI and MCP), this table is the map. Done: AI-1, AI-2, AI-3 (8a, PR #83), AI-4, AI-14, AI-15, AI-16, AI-17, AI-20, AI-24, AI-25, AI-27, AI-31 (M1); AI-26, AI-28, AI-29, AI-30 (M3). Cancelled: AI-12, AI-38. Merged M1 slices: [`history/m1-merged-slices.md`](architecture/history/m1-merged-slices.md).

| Milestone                                          | Open tickets, in order                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: First end-to-end flow: ticket → PR with Claude | In progress: AI-33: M1.8a: Plan approval; AI-36: Drop the Monitoring stage. Then AI-34: M1.8b: Gate and auto-merge (after both), AI-35: Docs at their word caps (alone). M1 closes when AI-34 merges.                        |
| M2: Self-hosting: andy-intelligence builds itself  | AI-39: Refine as the gate into the queue (first: it decides when refine speaks); AI-5: M1.9: Quota capture; AI-6: M1.17: Agent evals v1; the rest at milestone start (ADR-0060 lists it).                                    |
| M3: New UI and MCP                                 | AI-32: Who does the work (after AI-34); AI-37: Refine scores (after AI-39); AI-19: One permission function; MCP tools and command palette (to create, ADR-0059). AI-8 and AI-9: fold into the MCP and UI tickets at slicing. |
| M8: Project members                                | AI-18: Project members.                                                                                                                                                                                                      |

## Pending decisions (Andy)

- `blockedBy` holds ticket **keys** (`AI-1`); ARCHITECTURE §5 says ticket ids, and nothing reads the field yet. Keep keys (readable, unique across projects) and fix §5 in M1.8: Build + gate, where the dispatcher first reads it?
- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Production monitoring (alerts, error budget per project) as part of "shipped" (brief): add to M6: Dev → prod releases at slicing.
- Local mode design (open question 11); due after M1: First end-to-end flow.
- Context sources design (open question 12); due after M1: First end-to-end flow.

## Blocked on Andy

- Builds on project `AI`: run the live sandbox proof (runbook `agent-runs.md` §9), then switch on Builds; move AI-20, AI-24, AI-25 and AI-26 out of Ready first (their work is merged). Auto-build stays off until the first explicit build has run clean.
