---
title: "Threat model: one file per risk, register on demand"
status: proposed (AI-144; Andy decides at review)
date: 2026-11-20
amends: 0025 (where risks live), 0046 (threat-model budget)
---

# 0109 — Threat model: one file per risk, register printed on demand

AI-144: Threat model: one file per risk, table generated (epic AI-140: Parallel development without merge conflicts). Same rule as ADR-0103 for features and ADR-0104 for ADRs.

## Context and Problem Statement

Every PR that changes a trust boundary must add or edit a risk (ADR-0025). All risks sat in one Prettier-padded table in `docs/security/threat-model.md`, at its 3600-word cap (ADR-0046). Any merge there conflicted every other open PR, two PRs that each fit pushed `main` over together (twice in November 2026), workers trimmed other risks to make room, and two PRs both took R27. Closed risks R25 and R26 had been moved by hand to `closed-risks.md` to save words.

## Considered Options

1. Keep the table.
2. Risk files plus a committed table generated from them, with a CI check that it is fresh (what the ticket first asked). Two risk PRs still conflict on the table, and it still grows against a budget.
3. Risk files, no committed table: `pnpm risks` prints the register; read-only agents list risks with Grep.

## Decision Outcome

Option 3.

- One file per risk: `docs/security/risks/<ID>.md`, frontmatter `id` (equal to the file name), `severity`, `status`, `owner`; body `**Risk:**` then `**Mitigation / next step:**`. A closed risk keeps its file with `status: closed`; `closed-risks.md` is gone.
- `pnpm risks` (`scripts/risks.mjs`) prints the open register (every status but `closed`), then the closed risks. `pnpm test` fails on a malformed file, an id unlike its file name, or a reused id.
- `threat-model.md` keeps assets, area index, mitigations in place and the file format. Budgets: 300 words per risk file, `threat-model.md` lowered from 3600 to 1000.
- The per-PR security review gets the base branch's risk files in `.review/risks/` (`agent-review-prepare` now copies a folder). The system review may edit risk files and write new ones; its CI step still rejects any other change and any deletion.
- Managed repos keep the template's single table; both procedures say so.

### Consequences

- Good: two PRs that add or change different risks never conflict, and no budget grows with the number of risks.
- Good: a reused id is a file-name clash, which git shows as a conflict and the test catches.
- Bad: no committed one-page register on GitHub; the folder listing or `pnpm risks` replaces it.
- Bad: the system review can now create files (only `docs/security/risks/R*.md`); R9 records it.
