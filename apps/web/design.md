# Design source — control-plane UI

Every UI change follows this file (ADR-0059: UX foundation; ADR-0045: UI design system). Shortcut's simplicity is the starting point, not the look: a modern, minimalist design of our own, biased toward deciding (answer, approve, watch agents). A screen that needs a rule this file lacks adds it here.

Stack: React, Tailwind v4, shadcn/ui components in `src/components/ui/`, icons from `lucide-react`. Tokens live in `src/index.css`; use them through Tailwind classes (`bg-muted`, `text-attention`), never raw colours.

## Principles

- Simple before complete. One obvious way to do each thing.
- Status visible without opening anything: a card says where it is and what it waits for.
- Automatic by default, editable everywhere.
- Fast: keyboard first, nothing animates for show.

## Layout

- One shell on every screen (`src/components/AppShell.tsx`): header with the project picker, navigation, and the "Needs you N" count. Pages render inside it and never draw their own header.
- The picker is the global scope. Project screens live under `/p/<project>/…`, cross-project screens under `/all/…`. A new screen gets both forms, or says why it can't (the board needs one project).
- Content is full width with `px-4 sm:px-6` and `py-4`. Forms and prose cap at `max-w-2xl`.
- A ticket opens as a panel over the board, led by its status line; prose uses `Markdown`.

## Type

System font stack (Tailwind default). Four sizes only:

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
| Running         | `running`                        | A run in flight                                     |
| Success         | `success`                        | Checks passing, merged, Done                        |
| Danger          | `destructive`                    | Errors, failed checks, blocked                      |

A role colour is text or a 15% tint behind text (`bg-attention/15 text-attention`), never a solid block. Colour never carries meaning alone: a marker always has a word or icon too. Dark mode comes from the tokens; don't add `dark:` classes.

## Spacing and density

Data-heavy screens favour density over air:

- 4px grid: gaps `1`, `2`, `3`, `4`, `6`. Header height `h-12`. List rows `h-8`. Cards `p-2` with `gap-1`.
- Sections in a page: `space-y-4`. Header controls: `gap-2`, groups `gap-4`.
- Radius from `--radius` (`rounded-md`). Borders 1px `border-border`. Shadows only on things that float (menus, a dragged card).
- Show the number, not a chart: lane counts, waiting counts, elapsed minutes.

## Status markers

One small set, reused everywhere (board, inbox, panel, picker). Build them from `Badge` (`src/components/ui/badge.tsx`).

| Marker          | Shows                        | Look                                                            |
| --------------- | ---------------------------- | --------------------------------------------------------------- |
| Type            | Feature, chore, bug, epic    | Lucide icon in `muted-foreground`, type name as its title       |
| Size            | S, M, L                      | `Badge` default, the letter only                                |
| Run in flight   | Step and elapsed time        | `Badge variant="running"`: "Refining · 3 min"                   |
| PR state        | Number and state             | "PR #12 · open" neutral, `success` merged, `destructive` closed |
| Needs attention | The ticket waits on a human  | `Badge variant="attention"`: "2 questions", else "Needs you"    |
| Blocked         | An unfinished blocker        | `Badge variant="danger"`: "Blocked by AI-3"                     |
| Queue           | Place in Ready; what is next | Number before the key; `Badge variant="success"`: "Next"        |

No spinners or pulsing in markers: static text keeps screenshots stable.

## Copy

- Sentence case everywhere: "New ticket", "All projects", "Add project".
- "Needs you" for items waiting on the viewer (header count, inbox, badges). "Needs attention" is the ticket fact, used in docs and the API, not in the viewer's UI.
- Never a bare ID in prose or links: "AI-26: Design source and app shell". A card may show the key beside its title.
- Buttons are verbs. Empty states say what's missing: "Nothing needs you."
- Errors show the API's message (`QueryError`); never swallow one.

## Do and don't

| Do                                                           | Don't                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `<Badge variant="attention">Needs you</Badge>`               | `<span className="text-orange-600">!</span>`              |
| `text-sm` table with `h-8` rows                              | `text-base` cards with `p-6` and a shadow on each         |
| Put a new screen under `/p/$projectId/…` and `/all/…`        | Add a project dropdown inside one page                    |
| "Waiting for you: 2 questions"                               | "ACTION REQUIRED!!"                                       |
| Reuse `Button`, `Badge`, `DropdownMenu` from `components/ui` | Add a second component library or a one-off styled button |
| Change a colour in `index.css`                               | Hard-code `oklch(...)` or `#hex` in a component           |

## Checks

Playwright screenshots (`apps/web/e2e/`) cover the shell, board, story panel and inbox; CI fails on a diff. A deliberate change updates them in the same PR.
