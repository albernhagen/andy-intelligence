---
status: accepted
date: 2026-11-10
amends: 0079 (quota reserve)
---

# 0085 — Andy can clear a quota idle

Decided by Andy, 2026-11-10: asked "Do you want a control to clear a false quota pause?", he answered "a" (yes). Built in AI-74: Clear a quota idle.

## Context and Problem Statement

ADR-0079 stops dispatch on a fresh quota reading at the pause level (80%), taken in the last 6 hours. The AI-66 review found that a plausible but false high reading idles dispatch for up to 6 hours: neither pause nor the dial clears it, and a real lower reading is rejected as an implausible drop (threat model R24). Andy could only wait or start builds by hand.

## Decision Outcome

Andy can clear the quota readings that hold dispatch at the reserve (`QuotaClearer`, `packages/domain/src/quota.ts`).

| Rule           | What                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it clears | The fresh readings at the pause level that dispatch acts on. Nothing at the reserve: refused (`not_clearable`, 409).                                                                |
| Kept           | Nothing is deleted. The reading is marked `discarded` with who and when until the next reading replaces it; a `QuotaClear` record per reading is kept (`quotaClears`).              |
| Effect         | A discarded reading counts as missing: quota reads unknown, which doesn't stop dispatch (ADR-0079), and dispatch wakes in every project under its other caps.                       |
| Next reading   | Skips the drop check against the discarded reading; the reset-range and window checks still apply. `quotaRejection`'s rules are otherwise unchanged.                                |
| Bounded        | At most one clear per reading (id from provider, window and `takenAt`, in one transaction). A new high reading is a new reading.                                                    |
| Who and where  | Owner only, like the other setters: `POST /api/quota/clear`, MCP `clear_quota_idle`, a button in the quota banner and Project settings (AI-40 parity). The digest lists each clear. |

### Consequences

- Good: a false high no longer costs up to 6 hours of idle dispatch; each clear is visible and attributable.
- Bad: a clear trusts Andy over the reading; if the reading was true, dispatch spends into the reserve until the next run reports it again.
