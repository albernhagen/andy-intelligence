# Build log — status

Slice status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI (drag on the board, or Move to …), any move; cancel and archive also over MCP `cancel_ticket` / `archive_ticket`. Sessions and agents: MCP `move_ticket`, one step forward. PRs move their ticket on their own (AI-14: Tickets move on PR events): name the key in the branch, or start the PR description with the ticket link; opened → Ready for review, merged → Done, closed unmerged → In progress + Needs-you. M1.8: Build + gate relies on this.
- **Slice definitions:** [`architecture/milestones.md`](architecture/milestones.md) (ARCHITECTURE §12). A ticket's body names its row.

## Milestone map (ADR-0060: Milestones in completion order)

Every ticket sits under a milestone. Milestones are epic tickets in project `AI` (AI-21: M1, AI-22: M2, AI-23: M3); until tickets can be re-parented (M3: New UI and MCP), this table is the map. Done: AI-1, AI-2, AI-4, AI-14, AI-15, AI-16, AI-17, AI-20, AI-24, AI-25, AI-27 (M1); AI-26 (M3); merged M1 slices: [`history/m1-merged-slices.md`](architecture/history/m1-merged-slices.md).

| Milestone                                          | Open tickets, in order                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: First end-to-end flow: ticket → PR with Claude | AI-3: M1.8: Build + gate: 8a build run (in progress), then 8b gate (to create). AI-31: A merged PR completes its ticket from any stage.                                                                                                                                                                                         |
| M2: Self-hosting: andy-intelligence builds itself  | AI-5: M1.9: Quota capture; AI-6: M1.17: Agent evals v1; refine asks less and later (to create); the rest at milestone start (ADR-0060 lists it).                                                                                                                                                                                |
| M3: New UI and MCP                                 | In progress: AI-28: Board v2, AI-29: Story panel, AI-30: Inbox v2. Then AI-32: Who does the work (after AI-3 and AI-28), AI-19: One permission function, MCP tools and command palette (to create, ADR-0059). AI-8: Agent sessions keep tickets current and AI-9: Live UI updates: fold into the MCP and UI tickets at slicing. |
| M8: Project members                                | AI-18: Project members.                                                                                                                                                                                                                                                                                                         |

## Pending decisions (Andy)

- `blockedBy` holds ticket **keys** (`AI-1`); ARCHITECTURE §5 says ticket ids, and nothing reads the field yet. Keep keys (readable, unique across projects) and fix §5 in M1.8: Build + gate, where the dispatcher first reads it?
- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Production monitoring (alerts, error budget per project) as part of "shipped" (brief): add to M6: Dev → prod releases at slicing.
- Refine must ask at least one question (§4.3: 1–5). Allow zero for a ticket that is already clear?
- Local mode design (open question 11); due after M1: First end-to-end flow.
- Context sources design (open question 12); due after M1: First end-to-end flow.

## Blocked on Andy

- AI-1: M1.6a: Claude Code executor: after PR #51 merges, give the GitHub App Actions write and run the demos (runbook `agent-runs.md` §1, §3, §5).
