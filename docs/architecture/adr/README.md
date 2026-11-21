# Architecture decision records

One file per ADR (MADR; bodies immutable, frontmatter may change). Open only what you need (ADR-0046).

- **Index:** `pnpm adr` prints one line per ADR (number, title, status, what it amends or supersedes) from each file's frontmatter. Nothing to edit here (AI-142, ADR-0104).
- **A new ADR:** `NNNN-<slug>.md` with the next free number (a build gets one reserved, ADR-0080) and this frontmatter; `pnpm test` checks every ADR has a title and status and no two share a number:

```yaml
---
title: <short title for the index>
status: proposed
date: YYYY-MM-DD
amends: <ADR numbers, optional>
---
```

- **Changing a decision:** a new ADR, then update the old one's `status` line.
- ADRs before 0060 use old milestone numbers; 0060 maps them.
