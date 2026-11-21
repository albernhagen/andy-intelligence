# Design source — status markers

Moved unchanged from [design.md](design.md) (AI-221); every UI change follows it.

One small set, reused everywhere (board, inbox, panel, picker). Build them from `Badge` (`src/components/ui/badge.tsx`).

| Marker          | Shows                        | Look                                                            |
| --------------- | ---------------------------- | --------------------------------------------------------------- |
| Type            | Feature, chore, bug, epic    | Lucide icon in `muted-foreground`, type name as its title       |
| Size, score     | "S", "low risk"              | `Badge`; high risk `danger`                                     |
| Agent task      | Step and elapsed time        | `Badge variant="running"`: "Refining · 3 min"                   |
| PR state        | Number and state             | "PR #12 · open" neutral, `success` merged, `destructive` closed |
| Needs attention | The ticket waits on a human  | `Badge variant="attention"`: "2 questions", else "Needs you"    |
| Blocked         | An unfinished blocker        | `Badge variant="danger"`: "Blocked by AI-3"                     |
| Queue           | Place in Ready; what is next | Number before the key; `Badge variant="success"`: "Next"        |

No spinners or pulsing in markers: static text keeps screenshots stable.
