# Workflow as built (§4)

As-built notes for finished slices, moved out of [`workflow.md`](../workflow.md) to keep the rules short (ADR-0046, ADR-0061). Section numbers match it.

## §4.1 Stages

**Same-repo PRs move tickets:** key from the PR's head branch, else its description's first line (first `KEY-n` of the repo's project); the webhook records `pr_linked`, then moves it as `system`, every step in order, skipping only the DoR (ADR-0067): opened (not draft) into the default branch → Ready for review from Backlog, Ready or In progress; merged into it → Done from any stage but Done or Cancelled, withdrawing open questions (ADR-0056, ADR-0069); closed unmerged → In progress + Needs-you. Epics, archived and Cancelled tickets only get the link.

**Built (M1.8a, ADR-0063): Ready → In progress.** With a project's `buildEnabled` (recorded) and `autoBuild` on (both default off), the build dispatcher starts, on events only, the top Ready ticket by rank (never an epic or one assigned to Andy) whose DoR is met and blockers Done; one run per project, paused at 3 tickets In progress or Ready for review, ≤ 4 builds per ticket. Dispatch moves it to In progress; one retry, then Needs-you, branch kept.

**Built (M1.8a): plan approval (ADR-0050).** If `planApproval` (`none`, `m-and-l`, `all`) covers the ticket, a build start runs a read-only `plan` run first, then flags. Approve: the build gets the plan. Reject (with a reason): flagged until Andy re-plans; the next plan sees the reason. The dispatcher skips running, awaiting and rejected plans. Stale plans (ticket or policy changed, > 72 h) re-plan; ≤ 3 per ticket.

## §4.3 Refinement and questions

- **Built (M1.7, ADR-0054; trigger amended by ADR-0075):** refine starts on events (ticket entered Up next, last answer leaving the DoR unmet, run ended), top of Up next first, unless `autoRefine` is off. ≤ 3 runs per ticket; output written once per run; type, size, out of scope and touches only where empty (it asks to change a set field); failures flag Needs-you. If the ticket leaves Backlog mid-run, nothing is written; a comment quotes the questions (ADR-0073).
