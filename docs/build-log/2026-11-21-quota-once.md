# 2026-11-21 — AI-328: Quota is said once, in the header

From the AI-322 UX review (quick win 4).

- **Banner:** `QuotaBanner.tsx` shows only at warn or pause, when there is something to know or do. It no longer shows an unknown or failed reading, which the header gauge already says on every screen. On a phone that frees two lines of a 844 px screen.
- **Gauge:** an unknown window ("unknown", or "Quota unknown" on a phone) has a tooltip: "No fresh reading: don't assume there is headroom."
- **Failed read** (review): if `/api/quota` fails, the gauge shows "Quota unknown" at every width, so a quota signal never disappears.
- **Screen readers** (review): the hint is also in visually hidden text beside each "unknown", because `title` isn't read on touch devices. A sighted phone user sees "Quota unknown" without the hint, which this ticket accepts.
- **Dispatch:** unchanged. Unknown never stopped dispatch (ADR-0079); warn and pause banners are as before.
- **Phone check:** `phone-quota.spec.ts` serves a warn reading, so it still proves the banner fits at 390 px.
- **Screenshots:** the seeded fake API has no quota reading, so every screen loses the banner line and was re-rendered in the CI image.
