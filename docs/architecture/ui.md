# andy-intelligence — Components: UI

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 7. Components

### 7.5 UI (React + Vite + shadcn/ui + Tailwind, TanStack Router/Query/Table, dnd-kit, shadcn charts)
v1.x screens:
- **Needs-you inbox** (questions, gate reviews, pending config changes, quota warnings) — home screen.
- **Phone** (M7: Mobile, ADR-0052): the SPA installed from Safari, phone layout for the inbox, ticket detail, releases and quota banner; push deep-links to the item; answer, approve, promote, pause from the phone.
- **Quota & spend** (per provider gauges with reset times; paid spend vs caps; persistent banner on warn/pause/unknown; built: header gauge, banner).
- **Projects** (list, config, policy overrides).
- **Digest** (AI-70, ADR-0081): `/p/:projectId/digest`, header link in a project scope.
- **Tickets** — M1: board, ticket detail with history and linked runs/PRs/cost. M3 (ADR-0059): status on cards, story panel, command palette. M5: filter and group by project. M4: epic grouping, overrides editing.
- **Run detail** — M1: run summary inside ticket detail. M4: dedicated screen (metadata, cost, outcome, links to Action log / Jules session / PR).
- **Config** (providers, harnesses, models, tiers, policies; audit log with revert; pending approvals).
- **Releases** (dev status, promote to prod, rollback).
- **Dashboards** — M4 (ADR-0045): delivery (tickets by stage over time, lead time, rework, CI green on first try, review blockers), cost, quota and tokens per run and step over time (ADR-0046), per project and overall; aggregation queries + shadcn charts. DORA metrics from M6.

**Design (ADR-0045; M3, ADR-0059):** `apps/web/design.md` + shadcn theme tokens are the design source of truth agents and design skills read; Playwright screenshot checks. M4: design skills, pluggable per project (custom-skill context source, §7.6); Hallmark trial first; `sloplint --render` (non-blocking).

**Built in M1.3: UI: tickets + inbox:**
- Routes: `/projects`; `/p/:projectId` board; `/p/:projectId/t/:ticketRef` ticket panel (ref = key, e.g. `AI-2`; an id or wrong project switches to the canonical URL).
- Moves: one button per move in `TRANSITIONS` (`packages/domain`), plus "Force move…" (recorded). Cancel (optional reason), Archive/Unarchive. The API enforces rules; errors show inline.
- Client: `openapi-fetch` typed by `src/lib/api.gen.ts`, generated from `createApp`'s OpenAPI document (`gen:api`; a test fails when stale). Every write refetches all queries.
- Tests render the UI against the in-process API (`createApp` + fakes).
- Not yet: the kill switch's Needs-you item.

**Built in AI-26: Design source and app shell (M3, ADR-0059):**
- `apps/web/design.md` and the tokens in `index.css` (status roles `attention`, `running`, `success`; a `Badge` variant per marker).
- One shell (`AppShell.tsx`, the router's root): project picker (key + name, each project's waiting count, All projects, Add project), Board / Inbox / Settings, "Needs you N" across projects.
- Scope in the URL: `/p/:projectId/…` or `/all/…` (`/all/board` asks for a project). Last scope in `localStorage`; `/` redirects (replace) to its inbox. Every screen the shell reaches has its own URL; `routes.test.tsx` loads each directly.
- Inbox (AI-30): one card per ticket (type, key, linked title, stage) holding its open questions, or "Flagged for you" when it has none; under All projects, a heading per project with its count.
  - Order (`inboxCards`, `lib/needs-you.ts`): Backlog tickets whose only Definition of Ready gap is their questions, then tickets past Backlog, then other Backlog; ties by rank, then the most urgent question. Done, Cancelled and archived tickets last under "Stale".
  - Answers: suggested first and marked "Suggested"; one click answers; free text stays. "Accept all suggested" answers a card's questions in sequence and stops at the first error. An answer drops the question from the cached inbox at once, so every count updates without a reload.
- Screenshot checks: Playwright over the API with seeded fakes (`apps/web/e2e/`), CI job `ui-screenshots` (§8.1).

**Built in AI-28: Board v2 (M3, ADR-0059 row "Board"):**
- One read, `GET /api/projects/:id/board`: tickets with open question count, run in flight and latest PR (≤ 50 history reads, ADR-0028). Refetches every 5 s only while a run is in flight.
- Cards: type icon, key, title, then markers (size, worker, questions, run step and minutes, PR state, "Blocked by"). Ready is numbered; the first unblocked agent card says "Next".
- Worker markers: ADR-0082; never inbox items.
- Drag (mouse, touch, keyboard) within a lane sets `rank` through the ticket PATCH (`rankBetween`, `packages/domain`); across lanes moves (forced if not allowed, not onto Cancelled), then ranks at the drop. Optimistic; a refusal rolls back with the API's message on the card. A drop never opens the ticket (AI-25).
- Quick add atop Backlog (title only). Up next above Ideas (ADR-0075). Done starts as a counted strip; Cancelled and archived only with the toggle.

**Built in AI-29: Story panel (M3, ADR-0059):**
- The ticket route is the board's child (`<Outlet />`): a 640px panel, full page under 900px; Esc or Close returns.
- Status line (`lib/status-line.ts`, board rules from `lib/board.ts`): "Waiting for you: 2 questions", "Refining · 1 min", "Ready · next in the queue".
- One document (markdown description with Write / Preview, checklist, scope lists), a rail of moves and facts, questions, one timeline of history, comments and runs.
- Fields save in place, queued per ticket with the latest `updatedAt`; a 409 offers Reload; leaving with unsaved typing asks first.
- Descriptions, comments and questions render as safe markdown (`components/Markdown.tsx`; rules in the threat model's SPA line).

**Built in M1.19: GitHub App setup from the UI:** `/settings/github` (connect, install link, installed repos) and `/settings/github/callback`; the new-project form suggests installed repos.
