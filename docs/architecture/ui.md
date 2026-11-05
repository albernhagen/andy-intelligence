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
- Routes: `/projects`; `/p/:projectId` tickets in one column per stage; `/p/:projectId/t/:ticketRef` detail (ref = key, e.g. `AI-2`; an id or wrong project switches to the canonical URL).
- Detail: edit fields (type editable, empty until set; Tier pins `overrides.tier`, its empty option shows the tier from size; saves send `ifUpdatedAt`; a 409 asks Andy to reload), Definition of Ready from `/readiness`, history with comments, the ticket's questions, and "Ask a question…".
- Moves: one button per move in `TRANSITIONS` (`packages/domain`), plus "Force move…" (skips the rules; recorded). Board drag-and-drop (mouse, touch, keyboard): allowed column = normal move, else forced (not onto Cancelled). Cancel (optional reason), Archive/Unarchive, "Show archived" toggle. The API enforces rules; errors show inline.
- Client: `openapi-fetch` typed by `apps/web/src/lib/api.gen.ts`, generated in-process from `createApp`'s OpenAPI document (`pnpm --filter @andy/web gen:api`); a test fails when it is stale. Every write refetches all queries (one user, small data).
- Tests render the UI against the in-process API (`createApp` + fakes).
- Untrusted text renders as plain text (no HTML or markdown).
- Not yet: PR/cost panels, the kill switch's Needs-you item.

**Built in AI-26: Design source and app shell (M3, ADR-0059):**
- `apps/web/design.md` and the tokens in `index.css` (status roles `attention`, `running`, `success`; a `Badge` variant per marker).
- One shell (`AppShell.tsx`, the router's root): project picker (key + name, each project's waiting count, All projects, Add project), Board / Inbox / Settings, "Needs you N" across projects.
- Scope in the URL: `/p/:projectId/…` or `/all/…` (`/all/board` asks for a project). Last scope in `localStorage`; `/` redirects (replace) to its inbox. Every screen the shell reaches has its own URL; `routes.test.tsx` loads each directly.
- Inbox (AI-30): one card per ticket (type, key, linked title, stage) holding its open questions, or "Flagged for you" when it has none; under All projects, a heading per project with its count.
  - Order (`inboxCards`, `lib/needs-you.ts`): Backlog tickets whose only Definition of Ready gap is their questions, then tickets past Backlog, then other Backlog; ties by rank, then the most urgent question. Done, Cancelled and archived tickets last under "Stale".
  - Answers: suggested first and marked "Suggested"; one click answers; free text stays. "Accept all suggested" answers a card's questions in sequence and stops at the first error. An answer drops the question from the cached inbox at once, so every count updates without a reload.
- Screenshot checks: Playwright over the API with seeded fakes (`apps/web/e2e/`), CI job `ui-screenshots` (§8.1).

**Built in M1.19: GitHub App setup from the UI:** `/settings/github` (connect, install link, installed repos) and `/settings/github/callback`; the new-project form suggests installed repos.
