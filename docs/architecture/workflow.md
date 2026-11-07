# andy-intelligence — Workflow

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 4. Workflow

### 4.1 Stages (`ticket.stage`, shown as columns/groups in the UI)

| Stage | What happens | Exit criteria (automatic unless overridden) |
|---|---|---|
| **Backlog** | Refinement agent enriches; splits epics into stories (child tickets with dependencies); sizes; assigns tier; **asks Andy questions** | **Definition of Ready (DoR)** met |
| **Ready** | Waits for dependencies, agent assignee, quota/budget availability | Dispatcher starts a run |
| **In progress** | The executor's build run starts read-only and writes a plan into its summary, then implements it (ADR-0050). If the project's `planApproval` policy applies (`none` by default; `m-and-l` or `all`), the run stops after the plan, the ticket is flagged Needs-you, and build starts when Andy approves. One automatic retry, then flags Needs-you | PR opened with structured run summary (plan, deviations, verification output) |
| **Ready for review** | Rule-based gate decides auto-merge vs. Andy | Merged. No stage after it until M6: Dev → prod releases adds one for dev verification (ADR-0069) |
| **Done** | Summary included in rollups | — |
| **Cancelled** | Andy cancelled it; runs stop, questions withdrawn | Andy reopens it to Backlog |

**Stage moves** (`packages/domain`): forward one step, plus back for re-refine (ready → backlog), retry (in progress → ready) and rework (ready for review → in progress). Backlog → ready requires the DoR. Only Andy forces (reason optional, ADR-0057; history marks it), cancels (not a move), reopens, archives; MCP `move_ticket` moves one step forward. **Archived** (Done/Cancelled only) hides it from board, inbox, counts.

**Same-repo PRs move tickets:** key from the PR's head branch, else its description's first line (first `KEY-n` of the repo's project); the webhook records `pr_linked`, then moves it as `system`, every step in order, skipping only the DoR (ADR-0067): opened (not draft) into the default branch → Ready for review from Backlog, Ready or In progress; merged into it → Done from any stage but Done or Cancelled, withdrawing open questions (ADR-0056, ADR-0069); closed unmerged → In progress + Needs-you. Epics, archived and Cancelled tickets only get the link.

**Built (M1.8a, ADR-0063): Ready → In progress.** With a project's `buildEnabled` (recorded) and `autoBuild` on (both default off), the build dispatcher starts, on events only, the top Ready ticket by rank (never an epic or one assigned to Andy) whose DoR is met and blockers Done; one run per project, paused at 3 tickets In progress or Ready for review, ≤ 4 builds per ticket. Dispatch moves it to In progress; one retry, then Needs-you, branch kept. `planApproval` is next.

**Needs-you is a flag, not a stage.** Flagged items stay in their stage and appear in the Needs-you inbox (UI + MCP).

### 4.2 Definition of Ready (per type, ADR-0058)
- **Type** set: feature, chore, bug or epic. A title alone is a valid ticket; refine fills the type.
- Problem/intent stated (a non-empty body; for a bug, refine asks for steps to reproduce and the actual behaviour, which are not checked mechanically).
- Acceptance criteria: **feature**, at least one, each in **EARS** form, any sentence with "… shall …" ("WHEN … the API shall …"); **bug**, at least one stating the expected behaviour; **chore**, a "done when" checklist in any wording.
- Size tagged S/M/L with one-line justification (`sizeReason`) (rubric in `docs/agent/size-rubric.md`).
- Dependencies declared (ticket "blocked by" links).
- **No open questions.** Assumptions listed explicitly.
- Tier is not a readiness item: `tierFor` derives it from size (S → `fast`, Sonnet; M and L → `strong`, Opus; ADR-0050); `overrides.tier` pins one (ADR-0062).
- Per-project policy may allow "proceed on documented assumptions" for S tasks only; default is **require Andy's answers**. Overnight runs (ADR-0049) answer everything before launch and decide later ambiguity on recorded assumptions, listed in the morning report.
- **Epics** need only a stated intent and no open questions (no criteria or size).
- Checked in `packages/domain` (`checkDor`); `dorStatus` is computed on every change, never set by callers.

### 4.3 Refinement and questions
- Every ticket receives a refinement pass: the agent drafts the ticket, lists assumptions, and asks **1–5 targeted questions** (highest-impact ambiguities first; multiple choice with a suggested default where possible).
- Questions are **structured records** (§5 Question).
- Andy answers in UI or MCP. A `/refine` skill in Claude desktop batches pending questions across projects into one conversation.
- Answering re-checks the DoR; the last answer moves a Backlog ticket that meets it to Ready (`system`, `ifUpdatedAt`).
- **Built (M1.7, ADR-0054):** refine starts on events (ticket created, last answer leaving the DoR unmet, run ended), oldest ticket first, unless `autoRefine` is off. ≤ 3 runs per ticket; output written once per run; type, size, out of scope and touches only where empty (it asks to change a set field); failures flag Needs-you.

### 4.4 Epics
- Ticket types (Epic / Feature / Chore / Bug, ADR-0058) + **child tickets** (`parent_id`).
- Epic refinement produces stories with `depends_on`. Stories are vertical slices, independently mergeable behind feature flags; merge to `main`, no long-lived epic branches. Exception: an **overnight run** (ADR-0049) merges its stories into a one-night branch `epic/<key>`, reviewed by Andy as one PR the next morning.
- **Just-in-time re-planning:** when a story unblocks, a short plan pass re-reads the current codebase before execution. (Single tickets get it as the plan section of every build run, M1.8: Build + gate, ADR-0050.)
- Epic status, cost, and progress roll up from children. Overrides on an epic cascade to its stories.

### 4.5 Review gate (v1.x: rules only)
- **Hard vetoes → Andy reviews:** protected paths (CODEOWNERS: auth, payments, migrations, infra), dependency changes, CI not green, new behavior without new tests, no verification output in the run summary (ADR-0040), diff > N lines, any agent-raised concern.
- **Otherwise:** agent PRs merge on their own once every required check and both review agents pass (from M1.8: Build + gate, ADR-0050), per the project's `autoMerge` policy: `none` / `s` / `s-and-m` (default) / `all`.
- **Dependabot** (ADR-0042): npm patches and minors of 1.0+ packages auto-merge once every required check passes, and deploy only with Andy's next merge; majors, 0.x minors, GitHub Actions and Terraform providers go to Andy. CODEOWNERS (`* @albernhagen`) requests Andy's review on every PR he didn't author; paths listed after `*` are the protected paths above.
- From M1: First end-to-end flow onward, **record what the gate *would* have decided** to build the dataset for later model-based scoring.
- **Adversarial review** on every PR (ADR-0026): a fresh reviewer session tries to find reasons the PR should not merge, with a concrete failing scenario for each finding. Three passes: bugs and logic, plus (from M1.8: Build + gate) compliance with the ticket's acceptance criteria and approved plan; nits capped at 5 (ADR-0040). The implementer answers every finding. Unresolved `blocker` findings are a hard veto unless Andy labels `review-accepted`. From M9 the reviewer is a different vendor than the implementer.
- Security review on every PR (§9.1). A high/critical security finding is a hard veto unless Andy marks it `security-accepted`.

### 4.6 Environments and release
- Per project: separate GCP projects `<app>-dev` and `<app>-prod`.
- **Build once, promote the same image digest** via **Cloud Deploy** (dev → prod, approval required for prod, one-click rollback).
- On merge: deploy to dev → run smoke/e2e (Playwright + API tests) → verification agent summarizes results and logs onto the ticket.
- **Release:** "Promote to prod" from UI or MCP → Cloud Deploy approval → deploy. Release notes generated from tickets in the release.
- Agent write policy: dev writes allowed by project policy; prod is read-only for agents.
