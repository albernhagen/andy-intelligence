# Quota capture (as built)

M1.9: Quota capture. Design: ARCHITECTURE §5 and [observability-and-cost.md](../architecture/observability-and-cost.md) §10.5. What headless Claude Code exposes: `docs/build-log/2026-11-08-quota-capture.md`.

Claude subscription only, best-effort. A fresh reading at the pause level, taken in the last 6 hours, stops dispatch (ADR-0079); stale, older or missing readings don't.

| Step      | What                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source    | Claude Code's `rate_limit_event` message, field `rate_limit_info`. `scripts/executor-report.mjs` forwards the last event's windows as `rateLimits` in the run report.                                                 |
| Capture   | `POST /runs/{id}/report` (`apps/api/src/runs.ts`), the only place readings are written. A reading per window (5h, weekly), via `parseRateLimits` in `packages/domain/src/quota.ts`. A replayed report writes nothing. |
| Malformed | Discarded with one `quota reading discarded` log line; the last reading stays and the run report still succeeds.                                                                                                      |
| Storage   | Firestore `quotaReadings`, one document per provider and window (latest only).                                                                                                                                        |
| Read      | `GET /api/quota`: per window `freshness`, `level`, `usedPct`, plus the worst level. `usedPct` is null unless fresh.                                                                                                   |
| Fresh     | Until the window's `resetsAt` passes; with no `resetsAt`, 6 hours after `takenAt`. Stale or missing shows as **unknown**.                                                                                             |
| Levels    | From the §5 policy, 70% warn and 80% pause (`CLAUDE_SUB_THRESHOLDS`, constants until Provider documents exist). Worst first: pause, warn, unknown, ok.                                                                |
| UI        | Header gauge; banner under the header at warn, pause and unknown (lower severity), no dismiss. Refetched on window focus, no polling, so an idle tab costs nothing.                                                   |

## Check it works

After a subscription run ends, open the app: the header gauge should show the 5-hour and weekly percentages. Still unknown means no `rate_limit_event` with window data reached the report. Look for `quota reading discarded` or `quota reading not saved` in the API logs (component `run-callback`). Compare the percentages with Claude's own usage page: the units (`utilization` as a fraction, `resetsAt` in seconds) come from the CLI's schema, not a live event. Record the result in the build log.

## Trust

Any verified run report can write readings. Each is checked when written (`quotaRejection`, log line `quota reading rejected`): a reset further off than the window, a different window before the recent one resets, or a drop of over 5 points in a window is rejected. A false high still idles dispatch for at most 6 hours per report. Still to do: confirm the units above on a live event.
