---
title: Digest summary, written once a day by an agent task and stored
status: accepted (Andy, 2026-11-21, AI-323)
date: 2026-11-21
amends: 0081 (adds one stored document per project per day)
---

# 0137 — Digest summary, written once a day by an agent task and stored

AI-323: Digest: an AI-written summary of what was done. Andy wants a short model-written account at the top of the digest: what he can now do that he couldn't before, grouped by milestone or epic, each claim linked to its tickets or PRs.

## Context and Problem Statement

ADR-0081 computes the digest on every read; nothing is stored. A model call per read would cost quota and seconds on every view, and the digest's reads were just cut (AI-318). The summary has to be written once and read cheaply.

## Considered Options

1. **Route:** (a) a `summarize` agent task on the Claude subscription; (b) the direct executor (ADR-0129, AI-258) on a paid route; (c) whichever the step's tier routes to.
2. **AI-208: M4.30: Agent-written "what changed" paragraph per epic:** fold it in fully; share the engine; keep it separate.
3. **When:** daily, written on the first digest read after the day ends; daily on a schedule; weekly; on demand only.

## Decision Outcome

Andy chose 1(c) with (a) built now, 2 "share the engine", 3 "daily on first read".

- **Step:** new run step `summarize`, tier `fast`. It runs wherever routing sends it: today an agent task on the subscription; the direct executor once Andy turns on a paid route. No paid call otherwise. A config stored before the step existed reads it as `fast` (`LATER_STEP_TIERS`).
- **Day:** ends at midnight in `America/Denver` (`DIGEST_SUMMARY_TIME_ZONE`), a named zone, so daylight saving is right. The digest shows the latest finished day's summary, with its date.
- **Store:** `DigestSummaryStore`, one document per project per day (id `YYYY-MM-DD`): status `writing`, `ready` or `failed` (with the reason), output, task id, route, input hash. A digest read adds one point read.
- **Claim:** Andy's first digest read after the day ends claims it atomically, then starts the task. A second reader sees `writing`. A day with nothing merged or changed is stored as `nothing_happened`, with no task.
- **Input:** the day's release notes (ADR-0121), ticket and milestone changes, the digest's counts, as JSON fenced as untrusted data, never instructions.
- **Output:** a summary of at most 120 words and at most 12 lines, one per milestone or epic. Each cites at least one ticket or PR, and every one it cites must be in its input, or the summary fails. Checked by the executor's JSON schema and again in the domain.
- **AI-208** keeps only the display: the latest line for an epic on its roadmap row.

### Caps (ADR-0028)

| Cap                                      | Value                                                            |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Summaries per project per day            | 1, plus one retry by hand after a failure                        |
| Writes started per UTC day, all projects | 10                                                               |
| Input                                    | 50 PRs, 24,000 characters; the summary says when it was cut      |
| Dispatch                                 | pause, quota reserve and run caps (`mayDispatch`), unlike refine |

### Fail closed

- **Waits, no model call:** pause, the quota reserve or the run caps leave the claimed day `writing` with no task. Andy's next digest read tries the start again.
- **Fails:** no route, a dispatch error, a failed or timed-out task, bad output, or an unknown citation store `failed` with the reason.
- Either way the digest shows its plain list and says why. Nothing retries a failure on its own, and nothing falls back to a paid route.

### Consequences

- The digest stops being purely computed: one stored document per project per day, a cross-project daily counter, and a new step through the executor.
- A first read after midnight shows "writing" for the task's few minutes.
- `claude-executor.yml` and the procedure change in their own PR, Andy's to merge (ADR-0120).
