---
status: accepted
date: 2026-11-11
---

# 0091 — Live UI updates by tuned polling, no push

Decided by Andy, 2026-11-10, on AI-9: Live UI updates. His words: "We can do tuned polling. Browser access to GCP doesn't scale well beyond me." This replaces his earlier answer the same day (Firestore listeners from the browser). Built in AI-9.

## Context and Problem Statement

The UI should show changes made elsewhere (agent runs, MCP sessions, webhooks) without a reload: within 5 s on a visible page (AI-9 acceptance criteria). The API runs on Cloud Run and must scale to zero when nobody is looking. Before AI-9 only runs in flight polled; other views refetched on focus or after Andy's own writes.

## Considered Options

| Option                                     | Why not (or why)                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tuned polling through the API** (chosen) | No new trust boundary, cloud resource, rule or IAM change; a hidden tab makes no requests, so Cloud Run scales to zero.                                                               |
| Firestore realtime listeners from browser  | Needs Firebase Auth custom tokens and per-user read rules: browser access to GCP that does not extend to project members (M8).                                                        |
| SSE or WebSocket from Cloud Run            | An open stream keeps an instance up and billed while any tab is open; 60-minute request cap means reconnects. Preferred later if Cloud Run can hold idle streams without an instance. |
| Web Push                                   | Must show a notification; it is for alerts (M7: Mobile), not data refresh.                                                                                                            |

## Decision Outcome

One client module, `apps/web/src/lib/live.ts`, decides every polled query's interval; views don't. A push transport later replaces that module, not the views.

| Rule            | What                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Live views      | Board, ticket panel (ticket, readiness, history, questions, runs), inbox and header count, runs in flight: every 5 s.              |
| Slow views      | Projects, quota, ticket list, worker: every 60 s. Digest and GitHub setup: on focus only.                                          |
| Idle            | No pointer, key or wheel input for 5 min and no run in flight in that view's data: 60 s. The next input refetches at once.         |
| Hidden tab      | No polling (TanStack Query pauses intervals); focus or the tab becoming visible refetches.                                         |
| Unreachable API | A network error or 5xx doubles the interval per failed poll (10, 20, 40, 60 s); a shell banner says "Updates delayed"; data stays. |
| Cap (ADR-0028)  | Every interval is clamped to 5–60 s: no query polls faster than 5 s.                                                               |
| Own writes      | Unchanged: every write refetches all queries.                                                                                      |

No ETag or "changed since" read: a 304 still costs the Firestore reads behind it, and a cheap change marker needs a write on every change. Revisit if read cost shows up in the digest.

### Consequences

- Good: no new trust boundary or resource; scale to zero holds whenever no tab is visible; one place to tune or replace.
- Bad: a visible, active tab makes about 3 requests per 5 s on the board and about 8 with a ticket open, each reading Firestore; an idle visible tab about 5 to 12 a minute keeps an instance warm (request-billed, so idle time is not charged).
