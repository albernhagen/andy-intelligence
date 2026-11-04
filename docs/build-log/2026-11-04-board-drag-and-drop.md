# 2026-11-04 — Board drag-and-drop; forced moves no longer need a reason (AI-16)

- Andy asked for drag-and-drop on the board now, ahead of M5: Epics + story board (epic grouping and overrides editing stay there). Built with `@dnd-kit/core` (ARCHITECTURE §11's choice): mouse (8px to start, so a click still opens the ticket), touch (long-press), keyboard (Space picks up and drops, arrows move, Escape cancels; Enter still opens the ticket).
- A drop onto a column the domain allows sends a normal move, so its rules still apply (an unmet DoR on Backlog → Ready shows on the card and it stays put); any other column sends a forced move. No optimistic update: the card moves when the API accepts.
- Forced moves no longer need a reason (ADR-0054: Forced stage moves no longer need a reason): the domain's `reason_required` error is gone, a blank reason is stored as none, `forced: true` in history stays the audit trail. "Force move…" on the ticket page keeps an optional reason field.
- Tests: domain (forced without reason, blank reason, non-Andy forbidden), `dropMove`, and board UI tests that drag with the keyboard sensor against fake column rects (jsdom has no layout).
