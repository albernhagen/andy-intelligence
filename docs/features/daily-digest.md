# Daily digest

A model-written summary of yesterday on top (days end at midnight Mountain time; AI-323, ADR-0137): what Andy can now do, one line per milestone or epic, each with its tickets and PRs. The first read after midnight starts its one agent task; a failure says why and offers one retry. Then exceptions (failed tasks, PRs closed unmerged, rework, reverts, review blockers, tickets waiting on Andy or blocked, dispatch idle, quota at reserve), then merges (who, gate verdict, cost), in progress, totals (ADR-0081).

**Handover** (AI-385; live window only, computed on read):

- **Open PRs** (up to 20): each with one sentence per wait reason the merge gate recorded (`mergeVerdict`); no code-host call.
- **Next up** (up to 10): Ready tickets in dispatch order, each starts now, next or skipped with why, then why nothing more starts: a dry run of the dispatcher's checks (`next-up.ts`) that starts nothing.

Each says when cut short. Not shown: which check failed, why a session's PR waits, night-launch limits, a plan awaiting Andy, spend caps.

**How to use:** What's new in a project shows its exceptions first, then Open PRs and Next up, with a 24 hours window (`/p/AI/digest` opens it; AI-341); MCP `digest` with `project`, optional `hours`, `until`; `GET /api/projects/ai/digest`; retry a failed summary: What's new → **Retry once**, MCP `retry_digest_summary`
