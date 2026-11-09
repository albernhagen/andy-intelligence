# Build log — status

Slice status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI (drag on the board, or Move to …), any move; cancel and archive also over MCP `cancel_ticket` / `archive_ticket`. Sessions and agents: MCP `move_ticket`, one step forward. PRs move their ticket on their own (AI-14: Tickets move on PR events): name the key in the branch, or start the PR description with the ticket link; opened → Ready for review, merged → Done, from any open stage, whoever wrote the PR (ADR-0067); closed unmerged → In progress + Needs-you. M1.8: Build + gate relies on this.
- **Slice definitions:** [`architecture/milestones.md`](architecture/milestones.md) (ARCHITECTURE §12). A ticket's body names its row.

## Milestone map (ADR-0060: Milestones in completion order)

Every ticket sits under a milestone. Milestones are epic tickets in project `AI` (AI-21: M1, AI-22: M2, AI-23: M3); until tickets can be re-parented (M3: New UI and MCP), this table is the map. Done: AI-1 to AI-4, AI-14 to AI-17, AI-20, AI-24, AI-25, AI-27, AI-31, AI-33, AI-36 and the sandbox fixes AI-42, AI-47, AI-48, AI-50, AI-51, AI-54, AI-56, AI-58, AI-61 (M1); AI-26, AI-28, AI-29, AI-30 (M3). Cancelled: AI-8, AI-10, AI-12, AI-13, AI-38 and the sandbox proof tickets AI-45, AI-49, AI-52, AI-53, AI-55, AI-57, AI-59, AI-60. The sandbox proof passed on 2026-11-08 (`build-log/2026-11-08-sandbox-proof-passed.md`): Builds is on for project `AI`, auto-build off. Merged M1 slices: [`history/m1-merged-slices.md`](architecture/history/m1-merged-slices.md).

| Milestone                                          | Open tickets, in order                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: First end-to-end flow: ticket → PR with Claude | Tickets done (AI-34: M1.8b: Gate and auto-merge and AI-35: Docs at their word caps merged 2026-11-08). Left: the §9.1 milestone security review and the "Done when" check.                                                                                                                                                                                                                            |
| M2: Self-hosting: andy-intelligence builds itself  | AI-63: CI self-test of the sandbox check step merged 2026-11-09. In progress: AI-39: Refine as the gate into the queue. Next: AI-6: M1.17: Agent evals v1 (waits on the credential decision below); then parallel runs with Andy's dial, caps and pause, email notifications, cost per run and ticket, and the daily digest (ADR-0060), as tickets at the second batch.                               |
| M3: New UI and MCP                                 | Ready, after their dependencies: AI-32: Who does the work and AI-46: Project settings (ready); AI-37: Refine scores (after AI-39); AI-40: MCP parity rule and /inbox skill; AI-43: Call it an agent task (alone); AI-19: One permission function (alone, before new MCP write tools); AI-9: Live UI updates (waits on the Firestore-rules decision); AI-44: Local executor (slice 1: the design ADR). |
| M5: Multi-project in parallel                      | AI-65: Project planning baked into the flow (idea, 2026-11-09; refine at M5 start).                                                                                                                                                                                                                                                                                                                   |
| M8: Project members                                | AI-18: Project members (its refine questions wait on Andy).                                                                                                                                                                                                                                                                                                                                           |

## Pending decisions (Andy)

- `blockedBy` holds ticket **keys** (`AI-1`); ARCHITECTURE §5 says ticket ids, and nothing reads the field yet. Keep keys and fix §5 where the dispatcher first reads it?
- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Production monitoring (alerts, error budget per project) as part of "shipped" (brief): add to M6: Dev → prod releases at slicing.
- AI-6: M1.17: Agent evals v1: who pays for the model calls in CI: an API key with a hard cap, the subscription token through the executor, or recorded replays. Recommendation: the subscription token through the executor, with capped cases and turns.
- AI-9: Live UI updates: Firestore realtime listeners need Firebase Auth custom tokens and read-only Firestore rules for the owner's UID (IAM and rules), the alternative is SSE from Cloud Run. Recommendation: Firestore listeners, read-only rules for the owner only.
- AI-35 follow-up: widen the weekly system review's Edit allowlist to `docs/security/*.md` (a workflow change; the split keeps the register in the main file meanwhile).
- AI-39 low finding: a costly refine gap demoted by a question cap becomes an assumption and the ticket can still reach Ready. Hold it in Up next instead? Recommendation: yes, as a follow-up ticket; no blocker for PR #111.
- Local mode design (open question 11): AI-44 slice 1 is the design ADR. Context sources design (open question 12): after M1.

## Blocked on Andy

- Firestore export before the next schema-changing deploy (runbook `ticket-core.md`); the bucket exists.
- Merges, one at a time, each re-synced after the previous: AI-39 (PR #111), then the coordinator docs PR #105 (medium or high).
