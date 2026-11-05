# 2026-11-04 — Cancel and archive tickets

AI-15: Cancel and archive tickets.

- New stage `cancelled` (terminal, like Done). Only Andy reaches it, from any stage, with `TicketService.cancel` (UI "Cancel ticket…", `POST …/tickets/{t}/cancel`, MCP `cancel_ticket`); the optional reason is the stage event's body. It is not a move: `move` and forced moves to Cancelled are refused. Reopen = Move to Backlog, Andy only.
- Cancelling stops the ticket's runs in flight first (`RunService.cancelForTicket` → `Executor.cancel` → `CodeHost.cancelWorkflowRun`; Run status `cancelled`). If the executor can't stop a run, the call fails (`cancel_failed`, 502) and the stage doesn't change. A late report from a cancelled run is a no-op.
- Cancelling withdraws the ticket's open questions (status `withdrawn`, event `question_withdrawn`, kept in history) and clears Needs-you, so it leaves the inbox and `list_needs_me`. Reopening doesn't bring them back; refine asks again. Andy's decision on PR #63: AI-15: Cancel and archive tickets. New `WorkTracker.withdrawQuestion` (fake, Firestore, contract suite).
- The stage changes before questions are withdrawn, so a failure partway leaves a cancelled ticket, never a half-cancelled one. Cancelled tickets take no new questions (`ask` → `invalid_transition`), and the inbox skips them anyway. One that slips in during the cancel is withdrawn on reopen.
- With AI-14: Tickets move on PR events merged: PR webhooks never move a cancelled ticket (it isn't in the forward pipeline), and MCP `move_ticket` can't reopen one (`isForwardMove` now refuses stages outside the pipeline). Reopen is Andy's, in the UI.
- New Ticket flag `archived` (default `false`, so older documents read as unarchived). Only Done or Cancelled tickets can be archived (UI Archive/Unarchive, `POST …/archive`, MCP `archive_ticket`); leaving those stages unarchives. Archived tickets are left out of the board (unless "Show archived"), the Needs-you inbox (tickets and their questions) and `status` counts.
- Firestore: `archived: false` filters in memory, because an equality query would skip older documents without the field. No index, no infra change.
- No ADR: this extends ARCHITECTURE §4.1 without contradicting it. No new trust boundary: the routes sit behind the existing allow-listed API and MCP.
- To keep conflicts with AI-16: Board drag-and-drop small, the UI actions are in `CancelArchiveControls.tsx`, not `MoveControls.tsx`.
