# Board over MCP

Claude reads a project's board as the web shows it: every stage's lane in workflow order, each lane's tickets by rank, with what each card shows (epic, worker, open questions, blockers, the agent task in flight, the latest PR). Same read as the web board, so the two always agree (AI-296).

**How to use:** MCP `board` with `project`, optional `stage` for one lane, `archived: true` to include archived tickets and the Cancelled lane.
