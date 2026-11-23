# Night launch

An epic's panel has "Plan the night" (ADR-0049): every child ticket's open questions and plans with links, a budget (agent tasks, tokens, USD) and a stop time, and Launch, off with the reasons while anything is open. With GitHub connected, a launch opens `epic/<KEY>` for its child tickets (AI-122). While it runs: progress (done, running, stopped, skipped, waiting), spend against the budget, and Stop. Afterwards: the tickets stopped for the night with why and what they skipped, and how many night assumptions to review (AI-123).

**How to use:** open the epic, then "Plan the night"; or MCP `night_status`, `launch_night`, `stop_night` with the epic's key. Runbook: [overnight-runs.md](../runbooks/overnight-runs.md).
