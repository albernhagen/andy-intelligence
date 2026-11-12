# andy-intelligence — Components: UI

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 7. Components

### 7.5 UI (React + Vite + shadcn/ui + Tailwind, TanStack Router/Query/Table, dnd-kit, shadcn charts)
v1.x screens:
- **Needs-you inbox** (questions, gate reviews, pending config changes, quota warnings) — home screen.
- **Phone** (M7: Mobile, ADR-0052): the SPA installed from Safari, phone layout for the inbox, ticket detail, releases and quota banner; push deep-links to the item; answer, approve, promote, pause from the phone.
- **Quota & spend** (per provider gauges with reset times; paid spend vs caps; banner on warn/pause/unknown; built: header gauge, banner).
- **Project settings** (AI-46, built): `/p/:projectId/settings`, a header link; each switch explained, saved by the project PATCH. `/projects` opens the current project's; `/projects/new` adds one.
- **Digest** (AI-70, ADR-0081): `/p/:projectId/digest`, header link in a project scope.
- **Tickets** — M1: board, ticket detail with history and linked runs/PRs/cost. M3 (ADR-0059): status on cards, story panel, command palette. M5: filter and group by project. M4: overrides editing.
- **Run detail** — M4, built (AI-101); Jules links M9.
- **Config** (providers, harnesses, models, tiers, policies; audit log with revert; pending approvals).
- **Releases** (dev status, promote to prod, rollback).
- **Dashboards** — M4 (ADR-0045): delivery (tickets by stage over time, lead time, rework, CI green on first try, review blockers), cost, quota and tokens per run and step over time (ADR-0046), per project and overall; aggregation queries + shadcn charts. DORA metrics from M6.

**Design (ADR-0045; M3, ADR-0059):** `apps/web/design.md` + shadcn theme tokens are the design source of truth agents and design skills read; Playwright screenshot checks. M4: design skills, pluggable per project (custom-skill context source, §7.6); Hallmark trial first; `sloplint --render` (non-blocking).

**Built in M1.3: UI: tickets + inbox:**
- Routes: `/p/:projectId` board; `/p/:projectId/t/:ticketRef` ticket panel (ref = key, e.g. `AI-2`; an id or wrong project redirects).
- Moves: one button per move in `TRANSITIONS` (`packages/domain`), plus "Force move…" (recorded). Cancel (optional reason), Archive/Unarchive. The API enforces rules; errors show inline.
- Client: `openapi-fetch` typed by `src/lib/api.gen.ts`, generated from the API's OpenAPI document (`gen:api`; a test fails when stale). Every write refetches all queries.
- Tests render the UI against the in-process API.
- Not yet: the kill switch item.

**Built in AI-26: Design source and app shell (M3, ADR-0059):**
- `apps/web/design.md` and the tokens in `index.css` (status roles `attention`, `running`, `success`; a `Badge` variant per marker).
- One shell (`AppShell.tsx`, the router's root): project picker (key + name, each project's waiting count, All projects, Add project), Board / Inbox / Project settings / Settings, "Needs you N" across projects.
- Scope in the URL: `/p/:projectId/…` or `/all/…` (`/all/board` asks for a project). Last scope in `localStorage`; `/` redirects to its inbox. Every screen has its own URL (`routes.test.tsx`).
- Inbox (AI-30): one card per ticket (type, key, linked title, stage) holding its open questions, or "Flagged for you" when it has none; under All projects, a heading per project with its count.
  - Order (`inboxCards`, `lib/needs-you.ts`): Backlog tickets whose only Definition of Ready gap is their questions, then tickets past Backlog, then other Backlog; ties by rank, then the most urgent question. Done, Cancelled and archived tickets last under "Stale".
  - Answers: suggested first; one click answers; free text stays. "Accept all suggested" answers a card's questions in sequence and stops at the first error. An answer drops the question from the cached inbox at once, so every count updates without a reload.
- Screenshot checks: Playwright over the API with seeded fakes (`apps/web/e2e/`), CI job `ui-screenshots` (§8.1).

**Built in AI-28: Board v2 (M3, ADR-0059 row "Board"):**
- One read, `GET /api/projects/:id/board`: tickets with question count, run in flight, latest PR (≤ 50 history reads, ADR-0028).
- Cards: type icon, key, title, markers (size, worker, questions, run step and minutes, PR, "Blocked by"; worker: ADR-0082). Ready is numbered; the first unblocked agent card says "Next".
- Drag (mouse, touch, keyboard) within a lane sets `rank` (`rankBetween`); across lanes moves (forced if not allowed, not onto Cancelled), then ranks. Optimistic; a refusal rolls back, showing why. A drop never opens the ticket (AI-25).
- Quick add atop Backlog. Up next above Ideas (ADR-0075). Done is a counted strip; Cancelled and archived behind a toggle.
- Group by epic (AI-86, remembered): per lane, a header per epic (key, title, done of total), No epic last; rank stays per lane. Epic filter.

**Built in AI-29: Story panel (M3, ADR-0059):**
- The ticket route is the board's child (`<Outlet />`): a 640px panel, full page under 900px; Esc or Close returns.
- Status line (`lib/status-line.ts`): "Waiting for you: 2 questions", "Refining · 1 min".
- One document (markdown with Write / Preview, checklist, scope lists), a rail of moves and facts, questions, one timeline.
- Fields save in place, queued per ticket with the latest `updatedAt`; a 409 offers Reload; leaving with unsaved typing asks first.
- Descriptions, comments and questions render as safe markdown (`components/Markdown.tsx`).

**Built in M1.19: GitHub App setup from the UI:** `/settings/github` (connect, install link, installed repos); the new-project form suggests installed repos.

**Built in AI-9: Live updates (ADR-0091):** `lib/live.ts` sets every polled query's interval: 5 s in use or with a run in flight, else 60 s; none hidden. Failed polls back off; the shell shows "Updates delayed".

**Built in AI-101: M4.7: Run detail screen:** `/p/:projectId/runs/:runId`, opened from Activity; another project's task is not found.
