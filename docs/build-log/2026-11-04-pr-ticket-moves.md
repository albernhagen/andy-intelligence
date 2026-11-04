# 2026-11-04 — AI-14: Tickets move on PR events

AI-14: Tickets move on PR events: key-based webhook moves + MCP move_ticket. Pulled out of M1.8: Build + gate (AI-3) so PRs opened outside a control-plane run (Claude Code sessions) close out tickets too.

- **Key:** the first `KEY-n` of the repo's own project in the PR's head branch, else in the description's first line (the ticket link works). Only that first line is stored (capped at 256), next to the title.
- **Moves** (`PullRequestTickets`, `@andy/domain`): records `pr_linked`, then moves as `system`, one allowed step at a time, never forced, from Ready on. Opened/ready-for-review (not draft) → Ready for review; merged into the default branch → Done through Monitoring (ADR-0054: A merged PR completes its ticket until M6: Dev → prod releases; other bases only link); closed unmerged → In progress (from review or later) + Needs-you. Backlog tickets only get the link.
- **Replays:** moves run only when `CodeEventLog` records a delivery for the first time. A failure after recording is logged (`webhook ticket update failed`), not retried; Andy moves by hand.
- **Fork PRs never move tickets** (found while building): the repo is public, so anyone can open a PR naming a ticket. `fromFork` is set when the PR's head repo differs.
- **Reopened PR:** clears the Needs-you flag only when this PR's own close set it and no question is open (adversarial review on PR #64: AI-14).
- **`move_ticket`** (MCP): one step forward only (`TicketService.moveForward`); backward, skipping or forced moves stay with Andy in the UI. Actor is `andy` (every MCP caller is Andy).
- **Port:** `WorkTracker.linkPullRequest` appends `pr_linked` (fake, Firestore, contract suite).
- **AI-3: M1.8: Build + gate, ticket body** (Andy's to edit): drop "outcome set from merge/close webhook → ticket advances" as ticket work; M1.8 only sets the Run's outcome and relies on AI-14 for ticket moves.
