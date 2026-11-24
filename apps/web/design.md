# Design source — control-plane UI

Every UI change follows this file (ADR-0151: Design direction A "Instrument"). A dense, calm design of our own, biased toward deciding: answer, approve, watch (ADR-0070).

Reference tables (type scale, surfaces, colour roles, motion, do and don't): [`design-details.md`](design-details.md).

Stack: React, Tailwind v4, shadcn/ui components in `src/components/ui/`, icons from `lucide-react`. Tokens live in `src/index.css`; use them through Tailwind classes (`bg-muted`, `text-attention`), never raw colours.

## Principles

- Simple before complete. One obvious way to do each thing.
- Status visible without opening anything: a card says where it is and what it waits for.
- Automatic by default, editable everywhere.
- Fast: keyboard first; moves apply at once. Motion only explains a change (Motion below).
- Every write confirms where it happened (Feedback below).

## Layout

- One shell on every screen (`src/components/AppShell.tsx`): project picker, navigation, "Needs you N". Pages never draw their own header.
- The header holds at most six destinations (Inbox, Board, Roadmap, Work, Dashboards, What's new); every settings page and Sign out sit in one Settings menu, and settings pages share `SettingsTabs`. A new screen goes under an existing destination or replaces one (AI-335).
- The picker is the global scope: project screens under `/p/<project>/…`, cross-project under `/all/…`. A new screen gets both, or says why not (the board needs one project).
- Every page uses one of three [page templates](design-details.md#page-templates): list with detail, settings with section nav, reading page (screens move to them from AI-370). Padding `px-4 sm:px-6 py-4`.
- A ticket opens as a panel over the board, led by its status line; prose uses `Markdown`.

## Phone

Below `sm` (640px; `useIsPhone`):

- Navigation is a bottom bar: Board, Inbox, Dashboards, More.
- Touch targets at least 44px (`h-11 sm:h-8`); a checkbox's label is its target (`max-sm:min-h-11`). Inputs `text-base` so iOS doesn't zoom. Phone specs check it with `expectTouchTargets` (AI-334).
- Edge-touching elements pad by `env(safe-area-inset-*)`.
- No hover-only actions; panels open full-screen.
- Columns side by side become one at a time under `Segmented` tabs (the board's stages, AI-337).
- Nothing scrolls sideways at 390px: a strip that scrolls (the board's stage tabs) does so in its own `relative overflow-x-auto` box. Phone specs check it with `expectPageFits` (`e2e/phone.ts`, AI-325).

## Keyboard

`SHORTCUTS` in `src/lib/shortcuts.ts` (AI-338); `?` lists them. Never while typing; no single key writes. Screens opt in with `data-nav-*` and a visible focus outline.

## Type

Inter (`font-sans`) and Geist Mono (`font-mono`, keys and aligned numbers), both served by the app; never load a font from another host (the build checks). Six sizes, 13 px body: [type scale](design-details.md#type).

Counts, durations and ticket keys use `tabular-nums`. No sizes above `text-lg` (19 px), no bold beyond `font-semibold`.

## Surfaces and colour

Cool neutrals tinted toward indigo; three surface levels (sunken `muted`, base `background`, raised `raised`), a selected state (`bg-selected`, never the `primary` fill) and role colours: [table](design-details.md#surfaces-and-colour-roles). `primary` (indigo) is the one main button on a screen.

- A role colour is text or a 15% tint behind text (`bg-attention/15 text-attention`), never a solid block. Colour never carries meaning alone: a marker always has a word or icon too.

## Theme

System, light or dark from the Settings menu (More on a phone), remembered in this browser (`lib/theme.ts`). Tokens switch; no `dark:` classes. Check both.

## Motion

Motion explains a change (something appeared, moved or confirmed), never decorates: 120 to 180 ms, opacity and transform only, off under `prefers-reduced-motion`, never delays input. Tokens: [motion](design-details.md#motion).

## Spacing and density

Data-heavy screens favour density over air:

- 4px grid: gaps `1`, `2`, `3`, `4`, `6`. Header height `h-12`. List rows `h-8`. Cards `p-2` with `gap-1`.
- Sections in a page: `space-y-4`. Header controls: `gap-2`, groups `gap-4`.
- Radii: `rounded-sm` keys, `rounded-md` controls, `rounded-lg` cards and menus. Borders 1px `border-border`. Shadows only on things that float (menus, a dragged card).
- Show the number (lane count, minutes), not a chart.

## Status markers

The marker set: [`design-status-markers.md`](design-status-markers.md).

## Feedback

Every write confirms where it happened: the changed row, card or field shows the new value, and a failure shows the API's message there (`QueryError`). Shared confirmation components: AI-369.

## Copy

- Sentence case everywhere: "New ticket", "All projects", "Add project".
- "Needs you" in the UI for items waiting on the viewer; "Needs attention" is the ticket fact (docs, API). Every Needs-you count is tickets, one per inbox card however many questions it holds: header, picker, inbox headings and the work chip agree for the same scope. The chip names its extra parts: "Needs you · 4 tickets · 1 stale · 2 to pick a worker" (AI-347).
- Never a bare ID in prose or links: "AI-26: Design source and app shell".
- Say "agent task", never "run".
- Buttons are verbs. Empty states say what's missing: "Nothing needs you."
- Errors show the API's message (`QueryError`); never swallow one. A read passes `what` and `onRetry`, so a failure with no message reads "Couldn't read the GitHub connection (404)." with Retry.
- Times, durations and counts as words (`lib/format.ts`): "2:48 PM", "Nov 4, 2:50 PM", never seconds; past 90 minutes, hours or days ("17 days"); "5,000,000". Settings use their page labels and on/off (`lib/settings-labels.ts`).

## Checks

Playwright screenshots (`apps/web/e2e/`: every screen at 1280×800 and 390×844, four in dark) fail CI on a diff; a deliberate change updates them in the same PR (`pnpm --filter @andy/web screenshots:update`, in Docker).
