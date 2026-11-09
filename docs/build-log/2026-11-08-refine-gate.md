# 2026-11-08 — AI-39: Refine as the gate into the queue

Built Ideas / Up next on the Backlog stage, the measured question rule and caps, three refine outcomes, first-class assumptions (ADR-0075). `RefineGate` (`packages/domain/src/refine-gate.ts`) replaces the question writer in `runs.ts`.

- Read-side default (`upNextRank` null = Ideas), no `SCHEMA_VERSION` bump.
- The "at least one question" minimum is gone everywhere (settles the build-log pending decision).
- AI-2's stale flag is cleared by the rule: the inbox skips a flagged Done ticket without open questions.
- Existing open questions on tickets now in Ideas are left alone; not withdrawn automatically.
