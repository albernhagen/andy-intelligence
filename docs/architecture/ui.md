# andy-intelligence — Components: UI

Overview and reading map: [ARCHITECTURE.md](ARCHITECTURE.md). Section numbers match the overview's headings (ADR-0061).

## 7. Components

### 7.5 UI (React + Vite + shadcn/ui + Tailwind, TanStack Router/Query/Table, dnd-kit, shadcn charts)
v1.x screens:
- **Needs-you inbox** (questions, gate reviews, pending config changes, quota warnings) — home screen.
- **Phone** (M7: Mobile, ADR-0052): the SPA installed from Safari as a web app, phone layout for the inbox, ticket detail, releases and the quota banner; push notifications deep-link to the item; answer, approve plan or PR, promote, pause dispatch from the phone.
- **Quota & spend** (per provider gauges with reset times; paid spend vs caps; persistent banner on warn/pause).
- **Projects** (list, config, policy overrides).
- **Tickets** — M1: one column per stage with drag-and-drop (AI-16), ticket detail with history and linked runs/PRs/cost, create/edit. M3 (ADR-0059): project switcher, status on cards, story panel, command palette. M5: filter and group by project. M4: epic grouping, overrides editing.
- **Run detail** — M1: run summary inside ticket detail. M4: dedicated screen (metadata, cost, outcome, links to Action log / Jules session / PR).
- **Config** (providers, harnesses, models, tiers, policies; audit log with revert; pending approvals).
- **Releases** (dev status, promote to prod, rollback).
- **Dashboards** — M4 (ADR-0045): delivery (tickets by stage over time, lead time, rework, CI green on first try, review blockers), cost, quota and tokens per run and step over time (ADR-0046), per project and overall; aggregation queries + shadcn charts. DORA metrics from M6.

**Design (ADR-0045; M3, ADR-0059):** `apps/web/design.md` + shadcn theme tokens are the design source of truth agents and design skills read; Playwright screenshot checks. M4: design skills, pluggable per project (custom-skill context source, §7.6); Hallmark trial first; `sloplint --render` (non-blocking).

**Built in M1.3: UI: tickets + inbox:**
- Routes: `/` Needs-you inbox; `/projects`; `/p/:projectId` tickets in one column per stage; `/p/:projectId/t/:ticketRef` ticket (ref = key, e.g. `AI-2`; an id or wrong project switches to the canonical URL).
- Moves: one button per move in `TRANSITIONS` (`packages/domain`), plus "Force move…" (skips the rules; recorded). Board drag-and-drop (mouse, touch, keyboard): allowed column = normal move, else forced (not onto Cancelled). Cancel (optional reason), Archive/Unarchive, "Show archived" toggle. The API enforces rules; errors show inline.
- Client: `openapi-fetch` typed by `apps/web/src/lib/api.gen.ts`, generated in-process from `createApp`'s OpenAPI document (`pnpm --filter @andy/web gen:api`); a test fails when it is stale. Every write refetches all queries (one user, small data).
- Tests render the UI against the in-process API (`createApp` + fakes).
- Not yet: PR/cost panels, the kill switch's Needs-you item.

**Built in AI-26: Design source and app shell (M3, ADR-0059):**
- `apps/web/design.md` and the tokens in `index.css` (status roles `attention`, `running`, `success`; a `Badge` variant per marker).
- One shell (`AppShell.tsx`, the router's root): project picker (key + name, each project's waiting count, All projects, Add project), Board / Inbox / Settings, "Needs you N" across projects.
- Scope in the URL: `/p/:projectId/…` or `/all/…`; added `/p/:projectId/inbox`, `/all/inbox`, `/all/board` (asks for a project). Last scope in `localStorage`; `/` opens its inbox.
- Screenshot checks: Playwright over the API with seeded fakes (`apps/web/e2e/`), CI job `ui-screenshots` (§8.1).

**Built in AI-29: Story panel (M3, ADR-0059):**
- Route: `/p/:projectId/t/:ticketRef` is a child of the board route, rendered in the board's `<Outlet />`: a 640px panel over the board, full page under 900px. Esc (outside a field or editor) or Close returns to `/p/:projectId`; direct loads show the board with the panel.
- Status line first (`lib/status-line.ts`, one pure function): stage, open questions, run in flight (step, minutes), latest linked PR and its state, unfinished blockers, place in the Ready queue. E.g. "Waiting for you: 2 questions", "Refining · 1 min", "Ready · next in the queue", "Blocked by AI-3". No PR check state yet (the API has none).
- One document: title, markdown description (Write / Preview), checklist ("Done when" for a chore), assumptions, out of scope, touches. Rail: stage, moves, Definition of Ready, type, size and reason, tier (from size; choosing one pins `overrides.tier`), epic, blocked by, cancel and archive. Then questions (answered in place) and one timeline of history, comments and runs, with the comment box and "Start refine run".
- Edit in place: each field saves only itself with `ifUpdatedAt`; the saved ticket goes straight into the cache, so a quick next edit isn't a false conflict. A 409 shows the API's message and a Reload button; the draft stays. Lists add with Enter and remove with ×.
- Markdown (`components/Markdown.tsx`, `react-markdown` pinned) for descriptions, comments and question text, which is untrusted, partly agent-written: no `rehype-raw`, so HTML shows as text; only http, https and mailto URLs; images never load (a link labelled with the alt text); links open in a new tab with `rel="noopener noreferrer nofollow"` and show their host. Other text (run summaries, reasons) stays plain.

**Built in M1.19: GitHub App setup from the UI:** `/settings/github` (connect, install link, installed repos) and `/settings/github/callback`; the new-project form suggests installed repos.
