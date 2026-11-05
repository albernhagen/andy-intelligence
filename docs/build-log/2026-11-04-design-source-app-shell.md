# 2026-11-04 — Design source and app shell with the project picker (AI-26)

First slice of M3: New UI and MCP (ADR-0059: UX foundation, ADR-0060).

- `apps/web/design.md` is the design source for every later UI ticket and agent: type scale, colour roles, density, the status markers, copy rules, do and don't. Budget 900 words in `context-budget.json`.
- Theme tokens in `apps/web/src/index.css` gained `muted`, `ring` and three status roles: `attention`, `running`, `success`. `Badge` has a variant per marker; the board's "needs you" badge is now amber, not red.
- One app shell (`AppShell.tsx`): project picker (key badge + name, each project's waiting count, All projects, Add project), Board / Inbox / Settings, and "Needs you N" across projects. Built on shadcn's DropdownMenu (new dependency `@radix-ui/react-dropdown-menu`).
- Scope lives in the URL: `/p/<project>/…` or `/all/…`; new routes `/p/<project>/inbox`, `/all/inbox`, `/all/board` (asks for a project). The last scope is kept in `localStorage`; `/` opens its inbox. Old URLs still work.
- Screenshot checks: Playwright (`@playwright/test` 1.64.1) renders the shell, board and ticket page against the real API over seeded fakes, served by a test-only Vite config (`apps/web/e2e/`, no Firebase). New workflow `ui-screenshots.yml` → `platform/actions/ui-screenshots`, in the Playwright container image pinned by digest, 10-minute cap; on a diff it fails and uploads the images. Not a required check yet: adding it to the `main` ruleset is Andy's call.
- Waiting for AI-17's docs split to merge: ARCHITECTURE §7.5 (UI as built) and the §8.1 baseline row for the screenshot checks.
