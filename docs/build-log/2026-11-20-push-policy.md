# 2026-11-20 — AI-184: M7.8: Push policy

Pure push rules for M7: Mobile (ADR-0052), built on ADR-0115: M7 build choices' recommended answers to Q3 and Q4, which wait for Andy. Nothing sends yet: wiring is AI-192: M7.13, sending AI-178: M7.9.

- `packages/domain/src/notify-push.ts`:
  - **Payload** (`buildPushPayload`): "AI-150 · Question waiting", body "Project AI", a link on the app's own origin, and a tag. The input has no field for a title, question or run output, and both keys must match their key formats, so agent text can't get in (Q4: no title).
  - **Kinds** (`PushKind`): the seven `PushCategory` toggles, with quota split into `quota_warn` and `quota_paused`; only `quota_paused` breaks through quiet hours.
  - **Settings** (`pushGate`): a disabled category sends nothing; inside quiet hours (wrapping midnight, local time in the saved IANA zone, daylight saving followed) everything else is dropped, not delayed, since the inbox and email keep it.
  - **Caps** (`takePushSlot`, run inside `updateSendState`): 6 per UTC hour and 30 per UTC day, then one "More items need you" push per capped window; the day cap is checked first.
- **Named constants for Andy's answers:** `PUSH_HOURLY_CAP`, `PUSH_DAILY_CAP`, `PUSH_DEFAULT_QUIET_START`, `PUSH_DEFAULT_QUIET_END`, `PUSH_DEFAULT_TIME_ZONE`. The zone is `UTC` until Andy names his (Q3); his saved settings override every default.
- ARCHITECTURE §8.1: one row for the push caps, quiet hours, no agent text and the 10-subscription cap from AI-177: M7.7.
