# Design details — control-plane UI

Reference tables for [`design.md`](design.md), read when a change needs them. The rules stay in `design.md`.

## Type

| Use                                               | Class                 |
| ------------------------------------------------- | --------------------- |
| Page title (one per screen)                       | `text-lg font-medium` |
| Body, table cells, cards, buttons — the default   | `text-sm`             |
| Meta: keys, counts, badges, timestamps, help text | `text-xs`             |
| Section headings inside a page                    | `text-sm font-medium` |

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

## Do and don't

| Do                                                             | Don't                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `<Badge variant="attention">Needs you</Badge>`                 | `<span className="text-orange-600">!</span>`              |
| `text-sm` table with `h-8` rows                                | `text-base` cards with `p-6` and a shadow on each         |
| "Waiting for you: 2 questions"                                 | "ACTION REQUIRED!!"                                       |
| A per-row submit ("Answer" on each question) is `outline`      | A filled `primary` button on every row                    |
| A toggle that picks a view is `Segmented` (picked: `bg-muted`) | A `primary` fill on the picked option                     |
| Reuse `Button`, `Badge`, `DropdownMenu` from `components/ui`   | Add a second component library or a one-off styled button |
| Change a colour in `index.css`                                 | Hard-code `oklch(...)` or `#hex` in a component           |
| Put a new screen under `/p/$projectId/…` and `/all/…`          | Add a project dropdown inside one page                    |
