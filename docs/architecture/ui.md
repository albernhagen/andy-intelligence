# andy-intelligence — Components: UI

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 7. Components

### 7.5 UI (React + Vite + shadcn/ui + Tailwind, TanStack Router/Query/Table, dnd-kit, shadcn charts)
v1.x screens:
- **Needs-you inbox** (questions, gate reviews, pending config changes, quota warnings) — home screen.
- **Phone** (M7: Mobile, ADR-0052): the SPA installed from Safari as a web app, phone layout for the inbox, ticket detail, releases and the quota banner; push notifications deep-link to the item; answer, approve plan or PR, promote, pause dispatch from the phone.
- **Quota & spend** (per provider gauges with reset times; paid spend vs caps; persistent banner on warn/pause).
- **Projects** (list, config, policy overrides).
- **Tickets** — M1: board, ticket detail with history and linked runs/PRs/cost. M3 (ADR-0059): status on cards, story panel, command palette. M5: filter and group by project. M4: epic grouping, overrides editing.
- **Run detail** — M1: run summary inside ticket detail. M4: dedicated screen (metadata, cost, outcome, links to Action log / Jules session / PR).
- **Config** (providers, harnesses, models, tiers, policies; audit log with revert; pending approvals).
- **Releases** (dev status, promote to prod, rollback).
- **Dashboards** — M4 (ADR-0045): delivery (tickets by stage over time, lead time, rework, CI green on first try, review blockers), cost, quota and tokens per run and step over time (ADR-0046), per project and overall; aggregation queries + shadcn charts. DORA metrics from M6.

**Design (ADR-0045; M3, ADR-0059):** `apps/web/design.md` + shadcn theme tokens are the design source of truth agents and design skills read; Playwright screenshot checks. M4: design skills, pluggable per project (custom-skill context source, §7.6); Hallmark trial first; `sloplint --render` (non-blocking).

**Built in M1.3: UI: tickets + inbox:**
- Routes: `/` Needs-you inbox; `/projects`; `/p/:projectId` board; `/p/:projectId/t/:ticketRef` ticket panel (ref = key, e.g. `AI-2`; an id or wrong project switches to the canonical URL).
- Moves: one button per move in `TRANSITIONS` (`packages/domain`), plus "Force move…" (recorded). Cancel (optional reason), Archive/Unarchive. The API enforces rules; errors show inline.
- Client: `openapi-fetch` typed by `src/lib/api.gen.ts`, generated from `createApp`'s OpenAPI document (`gen:api`; a test fails when stale). Every write refetches all queries.
- Tests render the UI against the in-process API (`createApp` + fakes).
- Not yet: cost panels, the kill switch's Needs-you item.

**Built in AI-26: Design source and app shell (M3, ADR-0059):**
- `apps/web/design.md` and the tokens in `index.css` (status roles `attention`, `running`, `success`; a `Badge` variant per marker).
- One shell (`AppShell.tsx`, the router's root): project picker (key + name, each project's waiting count, All projects, Add project), Board / Inbox / Settings, "Needs you N" across projects.
- Scope in the URL: `/p/:projectId/…` or `/all/…`; added `/p/:projectId/inbox`, `/all/inbox`, `/all/board` (asks for a project). Last scope in `localStorage`; `/` opens its inbox.
- Screenshot checks: Playwright over the API with seeded fakes (`apps/web/e2e/`), CI job `ui-screenshots` (§8.1).

**Built in AI-28: Board v2 (M3, ADR-0059 row "Board"):**
- One read, `GET /api/projects/:id/board`: tickets with open question count, run in flight and latest PR (PR only for In progress, Ready for review, Monitoring; ≤ 50 history reads, ADR-0028). Refetches every 5 s only while a run is in flight.
- Cards: type icon, key, title, then markers (size, questions, run step and minutes, PR state, "Blocked by"). Ready is numbered; the first unblocked card says "Next".
- Drag (mouse, touch, keyboard) within a lane sets `rank` through the ticket PATCH (`rankBetween`, `packages/domain`); across lanes moves (forced if not allowed, not onto Cancelled), then ranks at the drop. Optimistic; a refusal rolls back with the API's message on the card. A drop never opens the ticket (AI-25).
- Quick add at the top of Backlog (title only). Monitoring and Done start as strips with counts; Cancelled and archived only with the toggle.

**Built in AI-29: Story panel (M3, ADR-0059):**
- `/p/:projectId/t/:ticketRef` is a child of the board route, in its `<Outlet />`: a 640px panel over the board, full page under 900px. Esc (outside an editor) or Close returns to the board.
- Status line first (`lib/status-line.ts`): stage, open questions, run in flight and minutes, latest PR state, open blockers, place in the Ready queue. E.g. "Waiting for you: 2 questions", "Refining · 1 min", "Ready · next in the queue".
- One document: title, markdown description (Write / Preview), checklist ("Done when" for a chore), assumptions, out of scope, touches. Rail: stage, moves, Definition of Ready, type, size, tier (choosing one pins `overrides.tier`), epic, blockers, cancel, archive. Then questions and one timeline of history, comments and runs, with the comment box and the start-run buttons.
- Edit in place: each field saves itself with `ifUpdatedAt`; saves queue per ticket and send the latest cached `updatedAt`, so quick edits don't conflict. A 409 offers Reload and keeps the draft. Leaving with unsaved typing asks first.
- Markdown (`components/Markdown.tsx`, `react-markdown` pinned) for descriptions, comments and questions (untrusted): no `rehype-raw` (HTML shows as text); only http, https, mailto URLs; images never load (a link with the alt text); links open in a new tab, `noopener noreferrer nofollow`, host shown. Other text stays plain.

**Built in M1.19: GitHub App setup from the UI:** `/settings/github` (connect, install link, installed repos) and `/settings/github/callback`; the new-project form suggests installed repos.
