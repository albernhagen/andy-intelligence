# 2026-11-02 — M1.3: UI: tickets + inbox built

- **Decided (Andy):** seed questions with "Ask a question…" on ticket detail; API client generated from OpenAPI (`openapi-typescript` + `openapi-fetch`, staleness test); no browser e2e yet (Playwright + Firebase Auth emulator is a follow-up).
- PR #28: M1.3: UI: tickets + inbox: Needs-you inbox (home), projects, tickets by stage, ticket detail (edit, Definition of Ready, moves incl. forced move with a reason, questions, history). UI tests run against the real API in-process. Not checked in a real browser (needs sign-in): Andy runs the Done when after deploy.
- Kill switch's Needs-you item (deferred to after this slice, 2026-11-01) is still not built: it needs workflow → API auth; its own slice.
