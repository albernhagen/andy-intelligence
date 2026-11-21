---
title: Brief in the agent task's prompt
status: proposed
date: 2026-11-20
amends: 0053 (who reads what: where the brief is carried)
---

# 0117 — The project brief rides in the agent task's prompt as an untrusted block

AI-112: M5.11: Brief in run context. ADR-0053 said the brief is carried "in each run request as `context`".

## Context and Problem Statement

Both executors (Actions and the local runner) get an agent task's instructions from `GET /runs/{id}/context`, whose `prompt` the control plane writes at dispatch; `RunRequest.instructions` is not what the agent reads. A new `context` field on `RunRequest` would need every executor to learn to place it, and the ticket snapshot already reaches the agent inside the prompt.

## Decision Outcome

- At dispatch, `RunService` reads `docs/product/brief.md` from the repo's default branch through the `CodeHost` port and appends a `<brief>` block to the prompt after the `<ticket>` block. No contract the executor reads changes; the stored `Run.prompt` records exactly what the agent saw.
- Per step (`BRIEF_PART_BY_STEP`): refine gets the whole brief; plan and build get Architectural expectations. Ideate, reviews and the system security review get theirs when they become agent tasks (AI-134 for ideate).
- Bounds: the block is JSON with `<` escaped, like the ticket snapshot, under a fixed line saying it is untrusted data and never instructions. The encoded text is capped at `BRIEF_CONTEXT_MAX_CHARS` (12,000) and marked `truncated` when cut.
- No brief, no matching section, or a failed read (logged as a warning): no block, and the task starts.

### Consequences

- Good: one place builds what the agent reads; nothing for executors to change; the brief's effect is visible in the stored prompt.
- Bad: the brief costs prompt tokens on every refine; a brief edited on the default branch reaches running tickets at their next agent task, not at a fixed version.
