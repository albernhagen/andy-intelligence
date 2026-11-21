# Design source — control-plane UI

Every UI change follows this file (ADR-0059: UX foundation; ADR-0045: UI design system). A minimalist design of our own, biased toward deciding: answer, approve, watch (ADR-0070).

Stack: React, Tailwind v4, shadcn/ui components in `src/components/ui/`, icons from `lucide-react`. Tokens live in `src/index.css`; use them through Tailwind classes (`bg-muted`, `text-attention`), never raw colours.

## Principles

- Simple before complete. One obvious way to do each thing.
- Status visible without opening anything: a card says where it is and what it waits for.
- Automatic by default, editable everywhere.
- Fast: keyboard first, nothing animates.

## Layout

- One shell on every screen (`src/components/AppShell.tsx`): project picker, navigation, "Needs you N". Pages never draw their own header.
- The picker is the global scope: project screens under `/p/<project>/…`, cross-project under `/all/…`. A new screen gets both, or says why not (the board needs one project).
- Content is full width with `px-4 sm:px-6` and `py-4`. Forms and prose cap at `max-w-2xl`.
- A ticket opens as a panel over the board, led by its status line; prose uses `Markdown`.

## Phone

Below `sm` (640px; `useIsPhone`); screens adopt these in their own M7: Mobile slices:

- Navigation is a bottom bar: Board, Inbox, Dashboards, More.
- Touch targets at least 44px (`h-11 sm:h-8`). Inputs `text-base` so iOS doesn't zoom.
- Edge-touching elements pad by `env(safe-area-inset-*)`.
- No hover-only actions; panels open full-screen.

## Type

System font stack. Four sizes (phone inputs add `text-base`):

| Use                                               | Class                 |
| ------------------------------------------------- | --------------------- |
| Page title (one per screen)                       | `text-lg font-medium` |
| Body, table cells, cards, buttons — the default   | `text-sm`             |
| Meta: keys, counts, badges, timestamps, help text | `text-xs`             |
| Section headings inside a page                    | `text-sm font-medium` |

Counts, durations and ticket keys use `tabular-nums`. No sizes above `text-lg`, no bold beyond `font-semibold`.

## Colour roles

| Role            | Token                            | Use                                                 |
| --------------- | -------------------------------- | --------------------------------------------------- |
| Surface         | `background`, `muted`            | Page; lanes, hovered rows, the selected picker item |
| Text            | `foreground`, `muted-foreground` | Primary text; meta and secondary text               |
| Lines           | `border`, `ring` (focus)         | Card and header borders; keyboard focus             |
| Action          | `primary`                        | The one main button on a screen                     |
| Needs attention | `attention`                      | Waiting on a human: "Needs you", open questions     |
| Running         | `running`                        | A task in flight                                    |
| Success         | `success`                        | Checks passing, merged, Done                        |
| Danger          | `destructive`                    | Errors, failed checks, blocked                      |

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
- "Needs you" in the UI for items waiting on the viewer; "Needs attention" is the ticket fact (docs, API).
- Never a bare ID in prose or links: "AI-26: Design source and app shell".
- Say "agent task", never "run".
- Buttons are verbs. Empty states say what's missing: "Nothing needs you."
- Errors show the API's message (`QueryError`); never swallow one.

## Do and don't

| Do                                                           | Don't                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `<Badge variant="attention">Needs you</Badge>`               | `<span className="text-orange-600">!</span>`              |
| `text-sm` table with `h-8` rows                              | `text-base` cards with `p-6` and a shadow on each         |
| "Waiting for you: 2 questions"                               | "ACTION REQUIRED!!"                                       |
| A per-row submit ("Answer" on each question) is `outline`    | A filled `primary` button on every row                    |
| Reuse `Button`, `Badge`, `DropdownMenu` from `components/ui` | Add a second component library or a one-off styled button |
| Change a colour in `index.css`                               | Hard-code `oklch(...)` or `#hex` in a component           |
| Put a new screen under `/p/$projectId/…` and `/all/…`        | Add a project dropdown inside one page                    |

## Checks

Playwright screenshots (`apps/web/e2e/`, phone ones at 390×844) fail CI on a diff; a deliberate change updates them in the same PR.
