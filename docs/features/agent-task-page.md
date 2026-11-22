# Agent task page

One agent task at `/p/<project>/runs/<id>`, led by its outcome (AI-340). A sentence first says what it did or is doing: "Refining AI-3 for 12 min on sonnet", "Built AI-7 in 10 min: PR #72, waits for you: protected path", "Failed after 3 min: <first line of the error>". The PR and the task log are buttons under it, beside the ticket and branch. Then **Details** (model, harness, provider, tier, attempts, times, outcome, the merge gate's verdict in words) and **Usage and cost** (tokens, cache, turns, cost, quota); a row with no value doesn't show, except cost, which says "unknown" once the task ends (never $0). The report, plan and verification follow. The page polls while the task is in flight.

**How to use:** open an agent task from a ticket's Activity; MCP `get_run` reads the same task
