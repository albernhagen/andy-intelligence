# Board over MCP

Claude reads a project's board as the web shows it: every stage's lane in workflow order, each lane's tickets by rank, with what each card shows (epic, worker, open questions, blockers, the agent task in flight, the latest PR). Same read as the web board, so the two always agree (AI-296).

**How to use:** MCP `board` with `project`, optional `stage` for one lane, `archived: true` to include archived tickets and the Cancelled lane.

**Moving a ticket:** MCP `move_ticket` with `ticket` and `to`. Forward is one stage at a time (Backlog → Ready needs the Definition of Ready); back is any earlier stage in one call, and a ticket moved back to Backlog lands in Ideas. Refused, with the reason: skipping forward, moving out of Done or Cancelled (Andy, in the web app), and moving back while an agent task or an open PR is on the ticket (ADR-0163).
