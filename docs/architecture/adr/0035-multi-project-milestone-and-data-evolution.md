---
status: accepted, amended by 0050, 0060 (milestone numbers and order)
date: 2026-11-01
---

# 0035 — Multi-project milestone moved up; data evolution for live control-plane data

Decided by Andy, 2026-11-01.

## Context and Problem Statement

1. Andy needs the control plane to build several systems in parallel soon. Multi-project work sat in M4: Second project + epics + story board, after Jules and paid models.
2. Andy will use the control plane for real from M1: First end-to-end flow on. Its Firestore then holds live data with no dev copy, so schema changes must not lose or break it.

## Decision Outcome

**Milestones** (ARCHITECTURE §12), renumbered:

| New | Milestone                       | Was                      |
| --- | ------------------------------- | ------------------------ |
| M2  | Multi-project in parallel (new) | part of M4               |
| M3  | Add Jules + model routing       | M2                       |
| M4  | Paid models + spend caps        | M3                       |
| M5  | Epics + story board             | M4 (minus multi-project) |
| M6  | Dev → prod releases             | M5                       |

M2: Multi-project in parallel = onboard N projects with the project baseline; **stories by project** (tickets listed, filtered and grouped per project in UI and MCP; inbox grouped by project); concurrent runs across projects under explicit caps (per project and global, ADR-0028); quota-aware dispatch keeping subscription reserves; agent API/MCP access scoped per project. ADRs written before 2026-11-01 use the old numbers.

**Data evolution** (ARCHITECTURE §10.4): changes are additive by default; a breaking change bumps `SCHEMA_VERSION` and ships a tested read-time upgrader plus an ADR; daily backups kept 7 days, a manual export before risky deploys, a restore drill per milestone.

### Consequences

- Good: parallel work across systems arrives right after M1; live data survives schema changes without a migration framework.
- Bad: renumbering makes older ADRs' milestone IDs stale (mapping in §12); Jules and paid-model routing arrive one milestone later; parallel runs on one subscription need careful caps.
