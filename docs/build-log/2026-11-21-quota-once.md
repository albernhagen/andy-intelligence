# 2026-11-21 — AI-328: Quota is said once, in the header

From the AI-322 UX review (quick win 4).

- **Banner:** `QuotaBanner.tsx` shows only at warn or pause, when there is something to know or do. It no longer shows an unknown or failed reading, which the header gauge already says on every screen. On a phone that frees two lines of a 844 px screen.
- **Gauge:** an unknown window ("unknown", or "Quota unknown" on a phone) has a tooltip: "No fresh reading: don't assume there is headroom."
- **Dispatch:** unchanged. Unknown never stopped dispatch (ADR-0079); warn and pause banners are as before.
- **Screenshots:** the seeded fake API has no quota reading, so every screen loses the banner line and was re-rendered in the CI image.
