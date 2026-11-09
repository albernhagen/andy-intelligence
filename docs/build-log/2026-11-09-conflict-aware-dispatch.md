# 2026-11-09 — Conflict-aware dispatch (AI-69: Conflict-aware dispatch, in-flight view, collision-free ADR numbers)

The build dispatcher now skips a Ready ticket whose `touches` overlap a build in flight and starts the next one (ADR-0080: Conflict-aware dispatch). Three of ADR-0047's four collision fixes are built; sync runs when `main` moves are next.

- Added: `overlaps` and friends in `packages/domain/src/dispatch-conflicts.ts`; `Run.touches` and `Run.reservedAdr` (optional, no schema bump); `lastDispatch` decision `touches_overlap`; status line "Waiting: overlaps AI-12 in flight"; `GET /api/projects/{id}/in-flight`, MCP `list_in_flight`, the board's In flight panel; a reserved ADR number in every build prompt; the build procedure's reserved-number rule.
- Choices: only build runs block (refine and plan are read-only); the status line is computed at read time from the in-flight view, so no ticket field or event was added; the reservation counts every run's number, finished ones too, so an open PR keeps its number.
- Outside the brief's file list, one line or block each: `RunStore.highestReservedAdr` in the port, fake and contract suite; `DispatchControls` text for the new decision; `TicketPage` and MCP `status` pass the in-flight view to the status line; `buildPrompt` gains the number line.
- For Andy: runs in flight when this deploys have empty `touches` and block every ticket until they end.
