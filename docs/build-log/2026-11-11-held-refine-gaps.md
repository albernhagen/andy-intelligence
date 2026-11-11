# 2026-11-11 — AI-75: held refine gaps

- Why: the security review of AI-39 (PR #111) found that a costly gap demoted by a question cap became an assumption, so the ticket could still reach Ready on a guess. Andy decided on 2026-11-10 (digest decision 6) that such a gap must hold the ticket. ADR-0087 records the rule.
- **Held gap:** an assumption with `demotedBy` set, a cost other than `reversible`, and status `assumed` (`isHeld`, `packages/domain/src/dor.ts`). `checkDor` lists "N held question(s) asked or accepted", so refine, the last answer and a manual move all refuse Ready. The ticket stays in Up next and in Needs-you. Its status line says "Waiting for you: N held question(s) (reached …)".
- **Asked when the cap allows:** `RefineDispatcher.askHeld` runs at the start of every `dispatchNext` (an answer, a run ending, a ticket entering Up next, a switch turned on), within both caps. There is no timer, so a gap held by the daily cap is asked at the first event after the window. Answers now dispatch even when other questions are still open, so a freed per-ticket slot is used.
- **Claim, then ask** (adversarial review, round 1): `askHeld` first marks the gaps `promoted` with a derived question id in one conditional write, then asks; overlapping dispatch events can't ask a gap twice or overrun the caps, and a lost ask is retried with the same id. Round 2: a lost claim takes its slot first, and `askHeld` is serialized per project in an instance (the security review's low finding); the cross-instance residual is in ADR-0087.
- **Accept:** `POST …/assumptions/{id}/accept` and the ticket page's "Accept as an assumption" button. They add the status `accepted` (an additive enum value: no `SCHEMA_VERSION` bump, no migration).
- Design choices settled by the coordinator, 2026-11-11; Andy may override them:
  - Accept is REST and UI only.
  - Retries are event-driven: no Cloud Tasks kind, no Scheduler.
- **Follow-up:** an MCP `accept_assumption` tool once AI-19: One permission function lands. Until then, over MCP, Andy promotes the gap with `promote_assumption` and answers it.
- Tests: domain (`dor`, `status-line`, `refine-gate` `askHeld`, `refine-dispatch`) and the real path in `apps/api/src/refine-gate-flow.test.ts`: held, reversible not held, asked after the window, bounded by the cap, promote over MCP, accept, refused accept, refused manual move.
