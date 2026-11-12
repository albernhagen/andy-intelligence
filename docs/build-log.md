# Build log — status

Slice status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI, any move; cancel and archive also over MCP `cancel_ticket` / `archive_ticket`. Sessions and agents: MCP `move_ticket`, one step forward. PRs move their ticket (AI-14): name the key in the branch, or start the description with the ticket link; opened → Ready for review, merged → Done, from any open stage (ADR-0067); closed unmerged → In progress + Needs-you.
- **Slice definitions:** [`architecture/milestones.md`](architecture/milestones.md) (ARCHITECTURE §12). A ticket's body names its row.

## Milestone map (ADR-0060: Milestones in completion order)

Every ticket sits under a milestone. Milestones are epic tickets in project `AI` (AI-21: M1, AI-22: M2, AI-23: M3); until tickets can be re-parented (M3: New UI and MCP), this table is the map. Done: AI-1 to AI-4, AI-14 to AI-17, AI-20, AI-24, AI-25, AI-27, AI-31, AI-33, AI-36 and the sandbox fixes AI-42, AI-47, AI-48, AI-50, AI-51, AI-54, AI-56, AI-58, AI-61 (M1); AI-26, AI-28, AI-29, AI-30 (M3). Cancelled: AI-8, AI-10, AI-12, AI-13, AI-38 and the sandbox proof tickets AI-45, AI-49, AI-52, AI-53, AI-55, AI-57, AI-59, AI-60. The sandbox proof passed on 2026-11-08 (`build-log/2026-11-08-sandbox-proof-passed.md`): Builds is on for project `AI`, auto-build off. Merged M1 slices: [`history/m1-merged-slices.md`](architecture/history/m1-merged-slices.md).

| Milestone                                          | Open tickets, in order                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: First end-to-end flow: ticket → PR with Claude | Closed 2026-11-10: all tickets done, "Done when" checked (auto-merge never exercised on project `AI`: `autoMerge` off), §9.1 security review merged (PR #126: no high or critical risks; R25 and R26 low, open).                                                                                                                                                                 |
| M2: Self-hosting: andy-intelligence builds itself  | All tickets merged (digests `build-log/2026-11-09-digest-m2.md`, `build-log/2026-11-11-digest.md`): the last were AI-73, AI-74, AI-75, AI-76, AI-77: Email notifications (off until Andy adds the key), AI-6: M1.17: Agent evals v1, AI-78. Left: the `autoMerge` trial and the "Done when" trial, both Andy's to start (auto-build on).                                         |
| M3: New UI and MCP                                 | Done: AI-32, AI-37, AI-40, AI-46, AI-9: Live UI updates (tuned polling), AI-19: One permission function, AI-44: Local executor design (ADR-0089). In progress since 2026-11-11: AI-43: Call it an agent task; AI-79: Local executor, control-plane side (ADR-0089 slices 2 to 4, one combined PR for Andy). After AI-79: the runner CLI, local publish, runbook (slices 5 to 7). |
| M4: Epics + story board                            | Sliced 2026-11-11 (AI-80): epic AI-84, 23 tickets, map in `architecture/m4-slices.md`. Batch 1 can start: AI-85, AI-86, AI-87, AI-88, AI-101, AI-102, AI-103, AI-104. AI-126, AI-128 and AI-129 wait on Andy.                                                                                                                                                                    |
| M5: Multi-project in parallel                      | AI-65: Project planning baked into the flow (planning required, Andy approves; refine at M5 start).                                                                                                                                                                                                                                                                              |
| M8: Project members                                | AI-18: Project members (questions answered 2026-11-10).                                                                                                                                                                                                                                                                                                                          |

## Pending decisions (Andy)

- `blockedBy` holds ticket **keys** (`AI-1`); ARCHITECTURE §5 says ticket ids, and nothing reads the field yet. Keep keys and fix §5 where the dispatcher first reads it?
- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Production monitoring (alerts, error budget per project) as part of "shipped" (brief): add to M6: Dev → prod releases at slicing.
- `autoMerge` on for project `AI`: after a trial of five tickets where the gate's `would_auto_merge` calls are compared with the coordinator's (Andy, 2026-11-10).
- Context sources design (open question 12).

## Blocked on Andy

- Firestore export before the next schema-changing deploy (runbook `ticket-core.md`); the bucket exists.
- For AI-77: Email notifications: a Resend account, a verified domain, one secret, then `terraform apply` (runbook `email-notifications.md`). High-risk PRs from the 2026-11-11 night batch, in the order the coordinator names.
- M4 questions, each in its ticket body: AI-126: M4.13: Hallmark trial (how to run it), AI-128: M4.15: Pluggable design skills (build now or move to Later), AI-129: M4.23: First overnight run trial (which epic and budget).
