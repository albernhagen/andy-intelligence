# 2026-11-11 — AI-9: Live UI updates, by tuned polling

- Andy changed the decision on 2026-11-10: tuned polling through the API, no push (ADR-0091: Live UI updates by tuned polling). No Firestore rules, Firebase Auth, IAM, Terraform or new resource.
- One module, `apps/web/src/lib/live.ts`, sets every polled query's interval: 5 s (the floor) while Andy is active or the view's data has a run in flight; 60 s after 5 min without input, and for slow views (projects, quota, ticket list, worker); none in a hidden tab; focus, the tab becoming visible, or input after idle refetches. Digest and GitHub setup refetch on focus only.
- Unreachable API (network error or 5xx): the interval doubles per failed poll up to 60 s, the shell shows "Updates delayed", and views keep their last data instead of an error (`showsError`). Each failed poll logs a console warning.
- Request rate, one visible tab: board about 3 requests per 5 s active, 5 a minute idle; with a ticket open about 8 per 5 s active, 12 a minute idle. Hidden or closed: 0, so Cloud Run scales to zero (request-billed, `cpu_idle`).
- No ETag or "changed since" read: a 304 still costs the Firestore reads behind it; a change marker needs a new write path.
