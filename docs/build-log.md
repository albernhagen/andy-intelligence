# Build log — status

Slice status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI (drag on the board, or Move to …), any move; cancel and archive also over MCP `cancel_ticket` / `archive_ticket`. Sessions and agents: MCP `move_ticket`, one step forward. PRs move their ticket on their own (AI-14: Tickets move on PR events): name the key in the branch, or start the PR description with the ticket link; opened → Ready for review, merged → Done, closed unmerged → In progress + Needs-you. M1.8: Build + gate relies on this.
- **Slice definitions:** [`architecture/milestones.md`](architecture/milestones.md) (ARCHITECTURE §12). A ticket's body names its row.

## Milestone map (ADR-0060: Milestones in completion order)

Every ticket sits under a milestone. Milestones are epic tickets in project `AI`; until tickets can be re-parented (M3: New UI and MCP), this table is the map. Done: AI-1, AI-2, AI-4, AI-14, AI-15, AI-16 (M1); merged M1 slices: [`history/m1-merged-slices.md`](architecture/history/m1-merged-slices.md).

| Milestone                                          | Open tickets, in order                                                                                                                                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: First end-to-end flow: ticket → PR with Claude | AI-17: Split ARCHITECTURE.md (alone, first) → ticket model v2 (ADR-0058, to create) → AI-3: M1.8: Build + gate, as 8a build run then 8b gate (to create). Any time: AI-20: Context-budget test overwrites the git index; the board-drop bug (to create). |
| M2: Self-hosting: andy-intelligence builds itself  | AI-5: M1.9: Quota capture; AI-6: M1.17: Agent evals v1; the rest at milestone start (ADR-0060 lists it).                                                                                                                                                 |
| M3: New UI and MCP                                 | Design source and app shell (may start beside M1), board v2, story panel, command palette, MCP tools (all to create, ADR-0059); AI-19: One permission function.                                                                                          |
| M8: Project members                                | AI-18: Project members.                                                                                                                                                                                                                                  |

## Pending decisions (Andy)

- `blockedBy` holds ticket **keys** (`AI-1`); ARCHITECTURE §5 says ticket ids, and nothing reads the field yet. Keep keys (readable, unique across projects) and fix §5 in M1.8: Build + gate, where the dispatcher first reads it?
- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Production monitoring (alerts, error budget per project) as part of "shipped" (brief): add to M6: Dev → prod releases at slicing.
- Refine must ask at least one question (§4.3: 1–5). Allow zero for a ticket that is already clear?
- Local mode design (open question 11); due after M1: First end-to-end flow.
- Context sources design (open question 12); due after M1: First end-to-end flow.

## Blocked on Andy

- AI-1: M1.6a: Claude Code executor: after PR #51 merges, give the GitHub App Actions write and run the demos (runbook `agent-runs.md` §1, §3, §5).
