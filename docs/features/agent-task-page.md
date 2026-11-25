# Agent task page

One agent task at `/p/<project>/runs/<id>`, rebuilt as a timeline (AI-377; first AI-340):

- **Top:** Board › ticket › step, a status badge with the elapsed time ("Running · 1 min", "Succeeded · 12 min") and **Open log**.
- **Sentence:** what it is doing or how it ended: "Refining AI-3 for 12 min on sonnet", "Built AI-7 in 10 min: PR #72, waits for you: protected path", While it waits on questions it asked: "It waits on your answer to one question."
- **Timeline**, newest first: queued, started, the questions it asked and the PR it opened (ticket events that name the task), publishing its branch, the end. While it runs, the top entry is what it does now: "Waiting on your answer" (its own open questions, with **Answer in inbox**) or "Refining now". A failed read shows its error with Retry.
- **Side panel** (below the sentence on a phone): model with tier, harness and provider; quota used; cost (unknown once it ends with none reported, never $0); PR; ticket.
- Below: the full error when it says more, report, plan, verification, **Details** (attempts, times, outcome, the merge gate's verdict, branch) and **Usage** (tokens, cache, turns).

Live: the task polls while in flight and the elapsed time ticks each second, so nothing needs a reload; the ticket's questions are read only while it runs.

**How to use:** open an agent task from a ticket's Activity; MCP `get_run` reads the same task
