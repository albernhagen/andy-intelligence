# Architecture decision records

One file per ADR (MADR; bodies immutable, frontmatter may change). No index is kept here, so no PR edits a shared list (AI-142, ADR-0104). Open only what you need (ADR-0046).

- **List them:** grep `^title:` and `^status:` in `docs/architecture/adr/*.md` (one line each; works with Read, Glob and Grep only). With a shell, `pnpm adr` prints the same as one line per ADR, with what each amends or supersedes.
- **A new ADR:** `NNNN-<slug>.md` with the next free number (a build gets one reserved, ADR-0080), a `# NNNN — <decision>` heading and this frontmatter. `pnpm test` checks every ADR has a title, a status and a heading matching its number, and that no two share a number.

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
