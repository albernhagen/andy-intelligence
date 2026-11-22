# Design source — control-plane UI

Every UI change follows this file (ADR-0059: UX foundation; ADR-0045: UI design system). A minimalist design of our own, biased toward deciding: answer, approve, watch (ADR-0070).

Reference tables (type, colour roles, do and don't): [`design-details.md`](design-details.md).

Stack: React, Tailwind v4, shadcn/ui components in `src/components/ui/`, icons from `lucide-react`. Tokens live in `src/index.css`; use them through Tailwind classes (`bg-muted`, `text-attention`), never raw colours.

## Principles

- Simple before complete. One obvious way to do each thing.
- Status visible without opening anything: a card says where it is and what it waits for.
- Automatic by default, editable everywhere.
- Fast: keyboard first, nothing animates.

## Layout

- One shell on every screen (`src/components/AppShell.tsx`): project picker, navigation, "Needs you N". Pages never draw their own header.
- The header holds at most six destinations (Inbox, Board, Roadmap, Work, Dashboards, What's new); every settings page and Sign out sit in one Settings menu, and settings pages share `SettingsTabs`. A new screen goes under an existing destination or replaces one (AI-335).
- The picker is the global scope: project screens under `/p/<project>/…`, cross-project under `/all/…`. A new screen gets both, or says why not (the board needs one project).
- Content is full width with `px-4 sm:px-6` and `py-4`. Forms and prose cap at `max-w-2xl`.
- A ticket opens as a panel over the board, led by its status line; prose uses `Markdown`.

## Phone

Below `sm` (640px; `useIsPhone`); screens adopt these in their own M7: Mobile slices:

- Navigation is a bottom bar: Board, Inbox, Dashboards, More.
- Touch targets at least 44px (`h-11 sm:h-8`). Inputs `text-base` so iOS doesn't zoom.
- Edge-touching elements pad by `env(safe-area-inset-*)`.
- No hover-only actions; panels open full-screen.
- Nothing scrolls sideways at 390px: a strip that scrolls (the board's lanes) does so in its own `relative overflow-x-auto` box. Phone specs check it with `expectPageFits` (`e2e/phone.ts`, AI-325).

## Keyboard

`SHORTCUTS` in `src/lib/shortcuts.ts` (AI-338); `?` lists them. Never while typing; no single key writes. Screens opt in with `data-nav-*` and a visible focus outline.

## Type

System font stack. Four sizes (phone inputs add `text-base`): [type table](design-details.md#type).

Counts, durations and ticket keys use `tabular-nums`. No sizes above `text-lg`, no bold beyond `font-semibold`.

## Colour roles

Eight roles, each with one use: [colour roles](design-details.md#colour-roles). `primary` is the one main button on a screen.

A role colour is text or a 15% tint behind text (`bg-attention/15 text-attention`), never a solid block. Colour never carries meaning alone: a marker always has a word or icon too. Dark mode comes from the tokens; don't add `dark:` classes.

## Spacing and density

Data-heavy screens favour density over air:

- 4px grid: gaps `1`, `2`, `3`, `4`, `6`. Header height `h-12`. List rows `h-8`. Cards `p-2` with `gap-1`.
- Sections in a page: `space-y-4`. Header controls: `gap-2`, groups `gap-4`.
- Radius from `--radius` (`rounded-md`). Borders 1px `border-border`. Shadows only on things that float (menus, a dragged card).
- Show the number (lane count, minutes), not a chart.

## Status markers

The marker set: [`design-status-markers.md`](design-status-markers.md).

## Copy

- Sentence case everywhere: "New ticket", "All projects", "Add project".
- "Needs you" in the UI for items waiting on the viewer; "Needs attention" is the ticket fact (docs, API). The header counts things to answer; the work chip counts tickets: "Needs you · 4 tickets" (AI-326).
- Never a bare ID in prose or links: "AI-26: Design source and app shell".
- Say "agent task", never "run".
- Buttons are verbs. Empty states say what's missing: "Nothing needs you."
- Errors show the API's message (`QueryError`); never swallow one.
- Times, durations and counts as words (`lib/format.ts`): "2:48 PM", "Nov 4, 2:50 PM", never seconds; past 90 minutes, hours or days ("17 days"); "5,000,000". Settings use their page labels and on/off (`lib/settings-labels.ts`).

## Checks

Playwright screenshots (`apps/web/e2e/`, phone ones at 390×844) fail CI on a diff; a deliberate change updates them in the same PR.
