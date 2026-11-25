# Design details — control-plane UI

Reference tables for [`design.md`](design.md), read when a change needs them. The rules stay in `design.md`.

## Type

Inter (13 px body) and Geist Mono, bundled (ADR-0151). Six steps:

| Use                                             | Class                   | Size / line |
| ----------------------------------------------- | ----------------------- | ----------- |
| Tags, section labels, keys (`<kbd>`)            | `text-2xs`              | 11 / 16 px  |
| Meta: counts, badges, timestamps, help text     | `text-xs`               | 12 / 16 px  |
| Body, table cells, cards, buttons — the default | `text-sm`               | 13 / 20 px  |
| Section headings, list headers, a question      | `text-md font-medium`   | 14 / 20 px  |
| Phone inputs only (iOS zooms below 16 px)       | `text-base`             | 16 / 24 px  |
| Page title (one per screen)                     | `text-lg font-semibold` | 19 / 26 px  |

Keys and numbers that line up: `font-mono` (Geist Mono) or `tabular-nums`.

## Surfaces and colour roles

| Role            | Token                            | Use                                                        |
| --------------- | -------------------------------- | ---------------------------------------------------------- |
| Sunken surface  | `muted`                          | Side areas, lanes, hovered rows                            |
| Base surface    | `background`                     | The page; inputs                                           |
| Raised surface  | `raised`                         | Cards, panels, menus, dialogs, outline buttons             |
| Selected        | `selected`, `selected-edge`      | The picked row, option or tab (a row adds a 2px left edge) |
| Text            | `foreground`, `muted-foreground` | Primary text; meta and secondary text                      |
| Lines           | `border`, `ring` (focus)         | Card and header borders; keyboard focus (indigo)           |
| Action          | `primary`                        | The one main button on a screen (indigo)                   |
| Needs attention | `attention`                      | Waiting on a human: "Needs you", open questions            |
| Running         | `running`                        | A task in flight                                           |
| Success         | `success`                        | Checks passing, merged, Done                               |
| Danger          | `destructive`                    | Errors, failed checks, blocked                             |

Radii: `rounded-sm` 4 px (keys), `rounded-md` 7 px (controls), `rounded-lg` 9 px (cards, menus).

## Motion

| Token                                             | Value                        | Use                                  |
| ------------------------------------------------- | ---------------------------- | ------------------------------------ |
| `--motion-fast`, `--motion-base`, `--motion-slow` | 120, 150, 180 ms             | Durations; nothing shorter or longer |
| `ease-standard`                                   | `cubic-bezier(0.2, 0, 0, 1)` | Every transition and animation       |
| `animate-enter`                                   | 150 ms fade and 2 px rise    | A menu, dialog or panel appearing    |

Opacity and transform only. `prefers-reduced-motion` turns every animation and transition off (index.css).

## Page templates

| Template                  | Shape                                                   | Screens                           |
| ------------------------- | ------------------------------------------------------- | --------------------------------- |
| List with detail          | A list; the picked item's detail beside it (raised)     | Inbox, board and its ticket panel |
| Settings with section nav | Section links on the left; one section's form beside it | Settings pages                    |
| Reading page              | One column, `max-w-2xl`                                 | What's new, a brief, help         |

## Do and don't

| Do                                                                | Don't                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| `<Badge variant="attention">Needs you</Badge>`                    | `<span className="text-orange-600">!</span>`              |
| `text-sm` table with `h-8` rows                                   | `text-base` cards with `p-6` and a shadow on each         |
| "Waiting for you: 2 questions"                                    | "ACTION REQUIRED!!"                                       |
| A per-row submit ("Answer" on each question) is `outline`         | A filled `primary` button on every row                    |
| A toggle that picks a view is `Segmented` (picked: `bg-selected`) | A `primary` fill on the picked option                     |
| Reuse `Button`, `Badge`, `DropdownMenu` from `components/ui`      | Add a second component library or a one-off styled button |
| Change a colour in `index.css`                                    | Hard-code `oklch(...)` or `#hex` in a component           |
| A card or menu on `bg-raised`                                     | A card on `bg-background` with a shadow to lift it        |
| Fade a menu in with `animate-enter`                               | Animate height, width or colour                           |
| Bundled fonts (`font-sans`, `font-mono`)                          | A `<link>` to a font host                                 |
| Put a new screen under `/p/$projectId/…` and `/all/…`             | Add a project dropdown inside one page                    |

## Feedback components

In `src/components/ui/` (AI-369), on Radix. Each works by keyboard alone, shows a focus ring, has 44px targets on a phone and moves only with `animate-enter` (150 ms, off under reduced motion).

| Component    | Use                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toast()`    | After a write succeeds: `toast({ title: "Answered AI-3", undo })`. Undo only when the write can be reversed; a failed undo shows its error. `<Toaster />` is mounted once in `main.tsx` |
| `Dialog`     | A decision that blocks: confirm a destructive write. Needs a `DialogTitle`; traps focus; Esc closes                                                                                     |
| `Sheet`      | Secondary detail or filters from an edge; full screen on a phone                                                                                                                        |
| `Tooltip`    | Repeats or explains a control; never the only place for information                                                                                                                     |
| `Skeleton`   | The shape of content while it loads; static, no pulse                                                                                                                                   |
| `EmptyState` | What is missing and the one next step                                                                                                                                                   |
| `Kbd`        | The key on the control it triggers; the control sets `aria-keyshortcuts`                                                                                                                |
