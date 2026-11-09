# 2026-11-08 — M1.9: Quota capture: what headless Claude Code exposes

AI-5: M1.9: Quota capture shipped the plumbing, gauge and banner. Whether real runs carry the data is **not yet proven**: the first subscription run after merge will show it.

## Finding

| Question                             | Answer                                                                                                                                             | Evidence                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Does `claude -p` have `rate_limits`? | Not under that name. `rate_limits` is the statusline's input; the `result` message has no such field.                                              | `result` message keys, local `stream-json` run, CLI 2.1.301        |
| What can a headless run see?         | A `rate_limit_event` message with `rate_limit_info`. Sub-field `unifiedWindows` has `five_hour` and `seven_day`, each `{ utilization, resetsAt }`. | Zod schema inside the CLI 2.1.301 binary                           |
| Units                                | `utilization` is a fraction, usually 0–1, above 1 past a cap. `resetsAt` is unix seconds.                                                          | Schema description in the binary                                   |
| When is it emitted?                  | When a window's rounded percentage or reset time moves. Both windows on every observation.                                                         | Same                                                               |
| Stable?                              | No. `unifiedWindows` is marked `@internal` and the Agent SDK docs don't cover it. It can change or vanish; readings then go unknown, by design.    | Same                                                               |
| Does it reach the executor?          | Yes in principle: claude-code-action (pinned v1.0.264) writes every SDK message to the execution file.                                             | The action's `base-action/src/run-claude-sdk.ts` at the pinned SHA |

## Not verified

- **A real event.** The local probe failed authentication (the OAuth session had expired), so no event was observed, and CI job logs don't print the messages (0 matches in the latest `adversarial-review` and `agent-run` logs).
- **The action's bundled CLI version** may be older than 2.1.301 and lack `unifiedWindows`.

To check after merge: `GET /api/quota` after one subscription run. Still unknown means no event arrived or it had no window data. Also compare the percentages with Claude's usage page, to confirm the units, before M2: Self-hosting gates on them.

## Decisions

- The top-level `utilization` and `rateLimitType` are a fallback for one window; `unifiedWindows` wins.
- Thresholds are the §5 defaults in code, because no Provider documents exist yet.
- Dispatch ignores readings (M2: Self-hosting). The pause banner says so.
