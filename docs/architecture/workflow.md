# andy-intelligence — Workflow

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 4. Workflow

### 4.1 Stages (`ticket.stage`, shown as columns/groups in the UI)

| Stage | What happens | Exit criteria (automatic unless overridden) |
|---|---|---|
| **Backlog** | Refinement agent enriches; splits epics into child tickets with dependencies; sizes; assigns tier; **asks Andy questions** | **Definition of Ready (DoR)** met |
| **Ready** | Waits for dependencies, a worker that is an agent (ADR-0082), quota/budget | Dispatcher starts a run |
| **In progress** | Build task: plans read-only, then implements (ADR-0050; plan approval below). One automatic retry, then flags Needs-you | PR opened with structured run summary (plan, deviations, verification output) |
| **Ready for review** | Rule-based gate decides auto-merge vs. Andy | Merged: → Done, or → Verifying (below) |
| **Verifying** | Projects whose `deployKind` isn't `none` (ADR-0114, AI-181): the merge deployed; the verify task (AI-188, ADR-0159) checks it by `platform/procedures/verify.md`; only a failed criterion or test fails it, skipped ones don't (Andy, 2026-11-26). Merges changing only `docs/**`, `infra/**`, `*.md` skip it. `VERIFYING_SWITCH` on since AI-188 | Verified → Done; failed → In progress + Needs-you. Over 2 hours → Needs-you |
| **Done** | Summary included in rollups | — |
| **Cancelled** | Andy cancelled it; runs stop, questions withdrawn | Andy reopens it to Backlog |

**Stage moves** (`packages/domain`): forward one step, plus back: re-refine (ready → backlog), retry (in progress → ready), rework (ready for review or verifying → in progress). Backlog → ready requires the DoR. A stage change clears Up next: moved back, a ticket lands in Ideas (AI-395). Only the owner forces (reason optional, ADR-0057; history marks it), cancels (not a move), reopens, archives (policy `can`, AI-19); MCP `move_ticket` steps forward or moves back any number of stages (ADR-0163). **Archived** (Done/Cancelled only) hides it from board, inbox, counts.

As built (PR events, build dispatch, plan approval): [`history/workflow-as-built.md`](history/workflow-as-built.md).

**Dispatch (ADR-0079, ADR-0080):** the build dispatcher takes Ready tickets from the top while `mayDispatch` says start (pause, dial, global and PR caps, quota) and records why. Then a night launch skips its child tickets at its task, token, USD or stop-time limit (caps' reason wins), ending once idle (AI-121). A run's end at the global cap offers others the slot first (AI-91). A ticket whose `touches` overlap a build in flight (empty overlaps any) waits. Builds record touches and a reserved ADR number (`list_in_flight`, board). **Sync runs (ADR-0083):** when `main` moves, each open agent PR behind it gets a run: merge `main`, resolve conflicts, check, push; global cap, not the dial; conflicts or failing checks flag Needs-you.

**Needs-you is a flag, not a stage:** flagged items stay put and appear in the Needs-you inbox (UI + MCP).

### 4.2 Definition of Ready (per type, ADR-0058)
- **Type** set: feature, chore, bug, spike or epic; refine fills it.
- Problem/intent stated (a non-empty body; for a bug, refine asks for steps to reproduce and actual behaviour, not checked mechanically).
- Acceptance criteria: **feature**, at least one, each in **EARS** form, any sentence with "… shall …" ("WHEN … the API shall …"); **bug**, at least one stating the expected behaviour; **chore**, a "done when" checklist, any wording; **spike**, what its findings answer.
- Size S/M/L with one-line justification (`sizeReason`) (rubric in `docs/agent/size-rubric.md`).
- Dependencies declared (ticket "blocked by" links).
- **No open questions** and no held gaps (§4.3). Assumptions listed.
- Tier is not a readiness item: `tierFor` derives it from size (S → `fast`, M and L → `strong`; ADR-0050); `overrides.tier` pins one (ADR-0062). The stored routing config picks each tier's route, Sonnet and Opus by default (`resolveRoute`, AI-238).
- Per-project policy may allow "proceed on documented assumptions" for S tasks only; default is **require Andy's answers**. Overnight runs (ADR-0049) answer everything before launch; later gaps: night assumptions; failures stop dependants.
- **Epics** need only a stated intent and no open questions (no criteria or size).
- Checked in `packages/domain` (`checkDor`); `dorStatus` is computed on every change, never set by callers.

### 4.3 Refinement and questions
- Backlog has **Ideas** (no agent spend) and **Up next**; entering Up next starts refinement (ADR-0075). The agent drafts, sends back or splits the ticket. Each gap is rated; the control plane makes it a question only if the agent is unsure or a wrong guess is costly to reverse, else an assumption Andy can promote. Zero questions is fine; at most 3 open per ticket, `dailyQuestionCap` per project per 24 hours. A costly gap past a cap is **held** (ADR-0087): the ticket stays in Up next, in Needs-you, until Andy accepts it or it is asked at the first dispatch event the caps allow (no timer).
- Refine also scores the ticket (AI-37): `risk` and `confidence`, each with a one-line reason, by the rubric in `platform/procedures/refine.md`. Filled only when empty; optional, never part of the DoR; the dispatcher ignores them. `startScore` is the one label board and MCP share; sorting Ready by score (`?sort=score`: size, risk, confidence) writes no rank.
- Questions are **structured records** (§5 Question) Andy can answer without the ticket: a question line, context, options with consequences, a recommendation (AI-73); refine output without them fails. Andy answers in the UI, MCP or the `/inbox` skill.
- Answering re-checks the DoR; the last answer moves an Up-next ticket that meets it to Ready (`system`, `ifUpdatedAt`).
- As built (refine dispatch): [`history/workflow-as-built.md`](history/workflow-as-built.md).

### 4.4 Epics
- Ticket types (Epic / Feature / Chore / Bug, ADR-0058) + **child tickets** (`parent_id`).
- Epic breakdown (AI-383, ADR-0155): for a top-level epic in an approved milestone, a read-only `plan-epic` agent task drafts up to 12 child tickets as a proposal. Approved, they land in Ideas with `blockedBy` set to sibling keys; sent back, Andy's note goes to the next draft. Caps: one task per epic in flight, 3 per epic in all.
- Epic refinement (built) produces child tickets with `blockedBy`: each an end-to-end change, independently mergeable behind flags; no long-lived branches. Exception: an **overnight run** (ADR-0049) merges child tickets into `epic/<key>`, one PR for Andy next morning; AI-122 builds on it, AI-124 merges there (ADR-0107), AI-125 posts the morning report on the epic. The `epic` merge mode (ADR-0124, AI-216) does the same by day: a child ticket builds on `epic/<key>` (made from the default branch's tip if missing), its clean PR merges there through the same path and it is Done; when the epic's last open child ticket is Done, one PR `epic/<key>` → default branch opens for Andy. A ticket with no epic builds on the default branch and waits for Andy, as in `manual`. Epic-branch merges skip the default branch's merge queue (AI-110): they never change the default branch.
- **Just-in-time re-planning** (built, M4.6): dispatch re-runs plans older than a blocker's Done.
- Epic status, cost and progress roll up; an epic's overrides cascade to its child tickets.

### 4.5 Review gate (v1.x: rules only)
Detail: [`review-gate.md`](review-gate.md).

### 4.6 Environments and release
- **Deploy kind** (ADR-0114), a project setting: `none` (default: no deploy, merge → Done) or `cloud-run`; other kinds (a static site) are later tickets.
- **Release contract** every kind meets: `deploy.yml` (push to `main` → first environment) and `release.yml` (`workflow_dispatch`: `action`, `environment`, `digest`, `revision`, `request`), each reporting its Deployment (environment, sha, digest, revision, url, status) over the Actions OIDC callback. Promote and rollback (owner, UI or MCP) dispatch it; the API holds no cloud credential.
- `cloud-run` kind: `environments` `prod-only` (`<app>-prod` + PR previews; default) or `dev-and-prod`; builds once and promotes the **same image digest** with the safe-deploy action; rollback pins an earlier revision.
- On merge: deploy to the first environment → one `verify` agent task for the Verifying tickets the deployed commit contains (AI-188, ADR-0159: read-only, WebFetch of the deployed host only; held at caps, quota or pause and retried when a task ends) → pass: Done; fail: In progress + Needs-you with the evidence. A failed deploy sends its tickets back the same way.
- Deploys are recorded (DORA); release notes from merged PRs' notes.
- Agent write policy: dev writes per project policy; prod read-only.
