# 2026-11-21 — Digest summary (AI-323)

Andy asked for the digest to summarize what was done with AI. Plan approved the same night (ADR-0137): a `summarize` agent task on the subscription, once a day per project, days ending at midnight Mountain time; AI-208 keeps only the roadmap display.

Three PRs:

1. Contracts: the `summarize` step, `DigestSummary`, `DigestSummaryStore` (fake, contract suite, Firestore).
2. Procedure, schema and the executor's no-tools handling (Andy's to merge).
3. Andy's first digest read claims the day and starts the task. The report stores the summary, which shows on the page and in MCP `digest`; failures can be retried once by hand.

Choices made while building:

- Pause, the quota reserve and the run caps don't fail the day. It waits, with no model call, and Andy's next read tries again. Otherwise a busy morning would burn the day's attempt.
- A quiet day is stored as `nothing_happened`, so later reads don't rebuild the input.
- Citations are checked against the input embedded in the run's prompt, so no new run field was needed.
