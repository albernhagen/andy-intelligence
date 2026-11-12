# Build log — status

Slice status lives in **tickets in project `AI`** (ADR-0047 phase 1). This page keeps only what tickets can't hold yet: pending decisions and blockers. What happened and why goes in the history: [`docs/build-log/`](build-log/), one new file per entry (`YYYY-MM-DD-<slug>.md`).

## Where to look

- **Tickets:** the UI at `https://ai.andybernhagen.com`, or the MCP `status` tool (connector `andy-intelligence`): no key → counts per stage; a key (e.g. `AI-1`) → stage, Definition of Ready gaps, questions, history.
- **Moving a ticket:** Andy, in the UI, any move; cancel and archive also over MCP `cancel_ticket` / `archive_ticket`. Sessions and agents: MCP `move_ticket`, one step forward. PRs move their ticket (AI-14): name the key in the branch, or start the description with the ticket link; opened → Ready for review, merged → Done, from any open stage (ADR-0067); closed unmerged → In progress + Needs-you.
- **Slice definitions:** [`architecture/milestones.md`](architecture/milestones.md) (ARCHITECTURE §12). A ticket's body names its row.

## Milestone map (ADR-0060: Milestones in completion order)

Every ticket sits under a milestone. Milestones are epic tickets in project `AI` (AI-21: M1, AI-22: M2, AI-23: M3); until tickets can be re-parented (M3: New UI and MCP), this table is the map. Done: AI-1 to AI-4, AI-14 to AI-17, AI-20, AI-24, AI-25, AI-27, AI-31, AI-33, AI-36 and the sandbox fixes AI-42, AI-47, AI-48, AI-50, AI-51, AI-54, AI-56, AI-58, AI-61 (M1); AI-26, AI-28, AI-29, AI-30 (M3). Cancelled: AI-8, AI-10, AI-12, AI-13, AI-38 and the sandbox proof tickets AI-45, AI-49, AI-52, AI-53, AI-55, AI-57, AI-59, AI-60. The sandbox proof passed on 2026-11-08 (`build-log/2026-11-08-sandbox-proof-passed.md`): Builds is on for project `AI`, auto-build off. Merged M1 slices: [`history/m1-merged-slices.md`](architecture/history/m1-merged-slices.md).

| Milestone                                          | Open tickets, in order                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: First end-to-end flow: ticket → PR with Claude | Closed 2026-11-10: all tickets done, "Done when" checked (auto-merge never exercised on project `AI`: `autoMerge` off), §9.1 security review merged (PR #126: no high or critical risks; R25 and R26 low, open).                                                                                                                                                                                                                                        |
| M2: Self-hosting: andy-intelligence builds itself  | All tickets merged (digests `build-log/2026-11-09-digest-m2.md`, `build-log/2026-11-11-digest.md`): the last were AI-73, AI-74, AI-75, AI-76, AI-77: Email notifications (off until Andy adds the key), AI-6: M1.17: Agent evals v1, AI-78. Left: the `autoMerge` trial and the "Done when" trial, both Andy's to start (auto-build on).                                                                                                                |
| M3: New UI and MCP                                 | Done: AI-32, AI-37, AI-40, AI-46, AI-9, AI-19, AI-43: Call it an agent task, and the local executor's design, control plane and runner CLI (AI-44, AI-79, AI-131; ADR-0089 slices 1 to 5). Open: AI-133: local build and publish (slice 6, PR #182, Andy); the runner-lock follow-up (PR #178, Andy); slice 7 (runbook and live proof) needs Andy's Mac. Digest `build-log/2026-11-12-digest.md`.                                                       |
| M4: Epics + story board                            | Epic AI-84, map in `architecture/m4-slices.md`. Merged 2026-11-12: AI-85, AI-86, AI-88, AI-101, AI-102, AI-104, AI-116. PRs waiting on Andy: AI-87 (#160), AI-103 (#169), AI-118 (#179), AI-120 (#187), AI-121 (#185), AI-122 (#180). Built, PR after its dependency merges: AI-115 (after #160), AI-117 (after #169). Not started: AI-119, AI-123, AI-124, AI-125, AI-127. AI-126, AI-128 and AI-129 wait on Andy.                                     |
| M5: Multi-project in parallel                      | Epic AI-82, table in `architecture/m5-slices.md`. Merged 2026-11-12: AI-89, AI-90, AI-91, AI-95, AI-96, AI-100 (part 1). PRs waiting on Andy: AI-83 (#167), AI-93, AI-94 and AI-98 (#163), AI-92 (#181), AI-100 part 2 (#186). Built, PR after its dependency merges: AI-107, AI-108, AI-114 (after #163); AI-97, AI-105 (after #167); AI-99 (after #181). Not started: AI-106, AI-109 to AI-113; new AI-134. AI-111: M5.4 waits on Andy (second repo). |
| M8: Project members                                | AI-18: Project members (questions answered 2026-11-10).                                                                                                                                                                                                                                                                                                                                                                                                 |

## Pending decisions (Andy)

- Contract suites for ports with one adapter (`OAuthGrantStore`, `CodeHostConnectionStore`): keep the fakes, drop the shared suite?
- Production monitoring (alerts, error budget per project) as part of "shipped" (brief): add to M6: Dev → prod releases at slicing.
- `autoMerge` on for project `AI`: after a trial of five tickets where the gate's `would_auto_merge` calls are compared with the coordinator's (Andy, 2026-11-10).
- Context sources design (open question 12).
- ADR-0094: Local executor build choices (AI-79, PR review): accept the six, or change any?
- ADR-0097: Review findings → config proposals (AI-100): accept the two-PR plan, the 3-PR threshold and `AGENTS.md` as the only target?
- ADR-0096: Managed repos call one executor (AI-83): Claude token in an environment on `main`, executor at `@main`, one repo per project?

## Blocked on Andy

- Firestore export before the next schema-changing deploy (runbook `ticket-core.md`); the bucket exists.
- For AI-77: Email notifications: a Resend account, a verified domain, one secret, then `terraform apply` (runbook `email-notifications.md`). High-risk PRs from the 2026-11-11 night batch, in the order the coordinator names.
- M4 questions, each in its ticket body: AI-126: M4.13: Hallmark trial (how to run it), AI-128: M4.15: Pluggable design skills (build now or move to Later), AI-129: M4.23: First overnight run trial (which epic and budget).
