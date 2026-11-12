# andy-intelligence — Workflow

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 4. Workflow

### 4.1 Stages (`ticket.stage`, shown as columns/groups in the UI)

| Stage | What happens | Exit criteria (automatic unless overridden) |
|---|---|---|
| **Backlog** | Refinement agent enriches; splits epics into stories (child tickets with dependencies); sizes; assigns tier; **asks Andy questions** | **Definition of Ready (DoR)** met |
| **Ready** | Waits for dependencies, a worker that is an agent (ADR-0082), quota/budget | Dispatcher starts a run |
| **In progress** | Build task: plans read-only, then implements (ADR-0050; plan approval below). One automatic retry, then flags Needs-you | PR opened with structured run summary (plan, deviations, verification output) |
| **Ready for review** | Rule-based gate decides auto-merge vs. Andy | Merged. No stage after it until M6: Dev → prod releases adds one for dev verification (ADR-0069) |
| **Done** | Summary included in rollups | — |
| **Cancelled** | Andy cancelled it; runs stop, questions withdrawn | Andy reopens it to Backlog |

**Stage moves** (`packages/domain`): forward one step, plus back: re-refine (ready → backlog), retry (in progress → ready), rework (ready for review → in progress). Backlog → ready requires the DoR. Only the owner forces (reason optional, ADR-0057; history marks it), cancels (not a move), reopens, archives (policy `can`, AI-19); MCP `move_ticket` steps forward. **Archived** (Done/Cancelled only) hides it from board, inbox, counts.

As built (PR events, build dispatch, plan approval): [`history/workflow-as-built.md`](history/workflow-as-built.md).

**Dispatch (ADR-0079, ADR-0080):** the build dispatcher takes Ready tickets from the top while `mayDispatch` says start (pause, dial, global and PR caps, quota) and stores why it stopped. A run's end wakes all projects, global-cap waiters first, its own last (AI-91). A ticket whose `touches` overlap a build in flight (empty overlaps any) waits. Builds record touches and a reserved ADR number (MCP `list_in_flight`, board). **Sync runs (ADR-0083):** when `main` moves, each open agent PR behind it gets a run that merges `main`, resolves conflicts, checks, pushes; global cap, not the dial; conflicts or failing checks flag Needs-you.

**Needs-you is a flag, not a stage:** flagged items stay put and appear in the Needs-you inbox (UI + MCP).

### 4.2 Definition of Ready (per type, ADR-0058)
- **Type** set: feature, chore, bug or epic; refine fills it.
- Problem/intent stated (a non-empty body; for a bug, refine asks for steps to reproduce and the actual behaviour, which are not checked mechanically).
- Acceptance criteria: **feature**, at least one, each in **EARS** form, any sentence with "… shall …" ("WHEN … the API shall …"); **bug**, at least one stating the expected behaviour; **chore**, a "done when" checklist in any wording.
- Size tagged S/M/L with one-line justification (`sizeReason`) (rubric in `docs/agent/size-rubric.md`).
- Dependencies declared (ticket "blocked by" links).
- **No open questions** and no held gaps (§4.3). Assumptions listed explicitly.
- Tier is not a readiness item: `tierFor` derives it from size (S → `fast`, Sonnet; M and L → `strong`, Opus; ADR-0050); `overrides.tier` pins one (ADR-0062).
- Per-project policy may allow "proceed on documented assumptions" for S tasks only; default is **require Andy's answers**. Overnight runs (ADR-0049) answer everything before launch; later ambiguity is decided on recorded assumptions.
- **Epics** need only a stated intent and no open questions (no criteria or size).
- Checked in `packages/domain` (`checkDor`); `dorStatus` is computed on every change, never set by callers.

### 4.3 Refinement and questions
- Backlog has **Ideas** (no agent spend) and **Up next**; entering Up next starts a refinement pass (ADR-0075). The agent drafts the ticket, or sends it back, or splits it. Each gap is rated; the control plane makes it a question only if the agent is unsure or a wrong guess is costly to reverse, else an assumption Andy can promote. Zero questions is allowed; at most 3 open per ticket and `dailyQuestionCap` per project per 24 hours. A costly gap past a cap is **held** (ADR-0087): the ticket stays in Up next, in Needs-you, until Andy accepts it or it is asked at the first dispatch event the caps allow (no timer).
- Refine also scores the ticket (AI-37): `risk` and `confidence`, each with a one-line reason, by the rubric in `platform/procedures/refine.md`. Filled only when empty; optional, never part of the DoR; the dispatcher ignores them. `startScore` is the one label board and MCP share; sorting Ready by score (`?sort=score`: size, risk, confidence) writes no rank.
- Questions are **structured records** (§5 Question) Andy can answer without the ticket: a question line, context, options with consequences, a recommendation (AI-73); refine output without them fails. Andy answers in the UI, MCP or the `/inbox` skill.
- Answering re-checks the DoR; the last answer moves an Up-next ticket that meets it to Ready (`system`, `ifUpdatedAt`).
- As built (refine dispatch): [`history/workflow-as-built.md`](history/workflow-as-built.md).

### 4.4 Epics
- Ticket types (Epic / Feature / Chore / Bug, ADR-0058) + **child tickets** (`parent_id`).
- Epic refinement produces stories with `depends_on`: vertical slices, independently mergeable behind flags; no long-lived epic branches. Exception: an **overnight run** (ADR-0049) merges its stories into a one-night branch `epic/<key>`, reviewed by Andy as one PR the next morning.
- **Just-in-time re-planning:** when a story unblocks, a plan pass re-reads the codebase.
- Epic status, cost and progress roll up; an epic's overrides cascade to its stories.

### 4.5 Review gate (v1.x: rules only)
- **Hard vetoes → Andy reviews:** protected paths (CODEOWNERS: auth, payments, migrations, infra), dependency changes, CI not green, new behavior without new tests, no verification output in the run summary (ADR-0040), diff > N lines, any agent-raised concern.
- **Otherwise:** agent PRs merge on their own once every required check and both review agents pass (from M1.8: Build + gate, ADR-0050), per the project's `autoMerge` policy: `none` / `s` / `s-and-m` (default) / `all`.
- **Built (M1.8: Build + gate):** vetoes for no verification output, protected or tooling path, and a required or review check not passing; diff size and new-behaviour-without-tests are a follow-up. Facts come from the host on each PR or finished-check webhook, never PR text. `wouldAutoMerge` is the gate's answer alone, recorded with `gateReasons` under every policy; the policy only decides whether the control plane merges. Merge: squash with the App token, pinned to the assessed head, one attempt per head; a failure flags the ticket; no merge while a sync is pending (`sync_pending`). Outcome and metrics come from the close webhook, on the Run.
- **Dependabot** (ADR-0042): npm patches and 1.0+ minors auto-merge once checks pass, deploying with Andy's next merge; the rest go to Andy. CODEOWNERS (`* @albernhagen`) requests Andy's review on every PR he didn't author; paths listed after `*` are the protected paths above.
- **Adversarial review** on every PR (ADR-0026): a fresh reviewer session tries to find reasons the PR should not merge, with a concrete failing scenario for each finding. Three passes: bugs and logic, plus (from M1.8: Build + gate) compliance with the ticket's acceptance criteria and approved plan; nits capped at 5 (ADR-0040). The implementer answers every finding. Unresolved `blocker` findings are a hard veto unless Andy labels `review-accepted`. From M9 the reviewer is a different vendor than the implementer.
- Security review on every PR (§9.1). A high/critical security finding is a hard veto unless Andy marks it `security-accepted`.

### 4.6 Environments and release
- Per project: GCP projects `<app>-dev` and `<app>-prod`.
- **Build once, promote the same image digest** via **Cloud Deploy** (dev → prod, approval required for prod, one-click rollback).
- On merge: deploy to dev → smoke/e2e (Playwright + API) → a verification agent logs the results on the ticket.
- **Release:** "Promote to prod" from UI or MCP → Cloud Deploy approval → deploy; notes from its tickets.
- Agent write policy: dev writes per project policy; prod read-only.
