# 2026-11-21 — Build dispatcher gets its night launch store and morning steps (AI-279)

Found while building AI-125: M4.22: Night: morning report in Needs-you. `apps/api/src/services.ts` built `BuildDispatcher` without its night launch store or morning opener, so in production the dispatcher's night step (`nightState`, ADR-0049 "Night budget", AI-121: M4.18) never ran.

- **What didn't happen:** no budget hold (max agent tasks, tokens, USD); stories kept starting after Stop; no launch ended on its own ("done" or a budget limit); unfinished stories weren't flagged; the morning PR and report waited for a Stop or a status read after the stop time.
- **What did work:** launches started, `epic/<KEY>` opened, stories built on it (`RunService` had the store), refine asked nothing overnight, and Stop or an expired stop time ended a launch through `settleNight`.
- **Fix:** one `MorningSteps` (morning PR, then report) built before the dispatcher and passed to both `BuildDispatcher` and `NightLaunches`, with the night launch store. Its flag looks up `TicketService` when a launch ends, since that service is built after the dispatcher.
- **Test:** `apps/api/src/night-dispatch.test.ts` builds the real app: a finished launch ends "done" with the report posted and the epic flagged, and a launch at its max agent tasks doesn't start its next story. Both fail without the fix.
