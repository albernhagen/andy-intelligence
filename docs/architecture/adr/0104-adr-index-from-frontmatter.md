---
title: ADR index printed from frontmatter
status: proposed (AI-142; Andy decides at review)
date: 2026-11-20
amends: 0046 (ADR index file), 0080 (where ADR numbers come from)
---

# 0104 — ADR index printed from each ADR's frontmatter; numbers from file names

AI-142: ADR index generated from each ADR's frontmatter (epic AI-140: Parallel development without merge conflicts). Same rule as ADR-0103 for features.

## Context and Problem Statement

`docs/architecture/adr/README.md` was a hand-edited table: every ADR PR added a row, prettier re-padded it, and open PRs conflicted. It sat at its 1500-word budget, so one more ADR broke `pnpm context:check`. Build runs reserved ADR numbers from its rows (ADR-0080).

## Considered Options

1. Keep the table.
2. A committed index generated from frontmatter, with a CI check that it's fresh. Two ADR PRs still conflict on it; it still grows against a budget.
3. No committed index: `pnpm adr` prints it from frontmatter; numbers come from file names.

## Decision Outcome

Option 3.

- Each ADR's frontmatter has `title` (short, for the index) and `status`; `amends` and `supersedes` show in the index when present. `docs/architecture/adr/README.md` explains the format and lists nothing.
- `pnpm adr` (`scripts/adr-index.mjs`) prints one line per ADR. `pnpm test` fails when an ADR lacks a title or status, or two ADRs share a number.
- Build runs reserve the next number above the highest `NNNN-*.md` in the ADR folder on the default branch (new `CodeHost.listFiles`), not above index rows. A managed repo with ADR files but no index now gets numbers too.
- Review procedures find ADRs by searching the folder for `^title:` (read-only agents can't run `pnpm`), or a managed repo's own index.
- Migration: titles copied from the index; seven frontmatter `status` lines took "amended by" facts only the index had (0032, 0047, 0054, 0058, 0075, 0079, 0083) and 0078's `amends` took 0058. ADR bodies unchanged.

### Consequences

- Good: ADR PRs never touch a shared file, and no budget grows with the number of ADRs.
- Good: two PRs that take the same number now fail `pnpm test` once both are on one branch.
- Bad: no committed one-page index on GitHub; the folder listing (file names carry the slug) or `pnpm adr` replaces it.
