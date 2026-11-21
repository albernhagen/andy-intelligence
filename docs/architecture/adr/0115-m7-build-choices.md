---
title: M7 build choices
status: proposed
date: 2026-11-20
amends: 0052 (push content, caps, gated-PR approval)
---

# 0115 — M7: Mobile: build choices

Slicing M7: Mobile (`docs/architecture/m7-slices.md`, epic AI-168: M7: Mobile). ADR-0052 left the caps to the slice and allowed a ticket title in a push; it also has the control plane merge a gated PR from the phone. Five choices below; Q1 to Q5 are Andy's to confirm at review, each with a recommendation.

## Decision Outcome

| #   | Choice                   | Recommendation                                                                                                                                                                     | Ticket |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| —   | Service worker           | Hand-written `sw.js`: `push` and `notificationclick` only, no caching, no `vite-plugin-pwa` (no new dependency, no stale app)                                                      | AI-172 |
| Q1  | Verify push first        | Andy tries a public Web Push demo on his iPhone (10 min) before push code is built; our own push is proven at AI-191                                                               | AI-171 |
| Q2  | VAPID keys               | Generated on Andy's Mac and added as a secret version (like the Resend key); never in Terraform state                                                                              | AI-179 |
| Q3  | Caps and quiet hours     | 6 pushes an hour, 30 a day, then one "more waiting" push; quiet hours 22:00–07:00 in Andy's time zone, dropped not delayed (inbox and email keep them); quota pause breaks through | AI-184 |
| Q4  | Push content             | Ticket key, project key, a fixed category phrase, a link. **No ticket title** either: agents create and retitle tickets, so a title can be agent text                              | AI-184 |
| Q5  | Gated PRs from the phone | "Open in GitHub" (the GitHub app reviews and merges as Andy) instead of an in-app merge with the App token                                                                         | AI-194 |

### Questions for Andy

**Q1:** Try Web Push on your iPhone with a public demo site before we build anything? It proves delivery, lock-screen display and tap-to-open on your iOS version in ten minutes. (a) Demo now: a failure stops M7 before push code exists. (b) Skip: first real push at AI-191: M7.12, after about ten slices. Recommend (a).

**Q2:** Generate the VAPID key pair on your Mac and add it as a secret version, as with the Resend key? (a) Local `npx web-push generate-vapid-keys` + `gcloud secrets versions add`: two minutes, key never in state. (b) Terraform `tls_private_key`: no manual step, key in state, conversion code. Recommend (a).

**Q3:** Push caps of 6 an hour and 30 a day, quiet hours 22:00–07:00, dropped not delayed? (a) These, plus your time zone: no extra work. (b) Your numbers: same work. (c) A summary push when quiet hours end: one more S slice (scheduled flush). Recommend (a).

**Q4:** Leave ticket titles out of pushes, showing only key, project and category? (a) Title capped at 100 (ADR-0052 as written): agent text can reach the lock screen. (b) Title only if a person wrote it: needs title provenance, one more S slice. (c) Never. Recommend (c).

**Q5:** Approve gated PRs by opening them in the GitHub app instead of merging from our app? (a) Link out: S, medium risk, no new write path. (b) In-app approve and merge with the App token: M, high risk, a new merge path. Recommend (a).

### Consequences

- Good: no agent text on the lock screen; no new merge path; one new dependency (`web-push`) and one new credential, each in its own small high-risk slice.
- Bad: a push says only "AI-150 · Question waiting", so Andy taps to see what it is; approving a PR needs the GitHub app; pushes during quiet hours are not replayed.
