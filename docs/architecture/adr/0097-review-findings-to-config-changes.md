---
status: proposed (AI-100; Andy decides at review)
date: 2026-11-12
implements: 0040 row 5 (repeated review findings become a pending ConfigChange)
---

# 0097 — Repeated review findings become pending config changes

AI-100: M5.20: Repeated review findings become a pending ConfigChange. ADR-0040 planned it; this records how, in two PRs.

## Context

- The PR review agents (security, adversarial) write findings into a sticky PR comment only (`scripts/review-gate.mjs`). The control plane stores none of them: `RunMetrics.reviewFailures` keeps failed check names, not findings.
- Findings have no category: grouping free-text titles would be guesswork.
- Finding text is untrusted: an agent wrote it after reading PR content.
- The `ConfigChange` entity and `configChanges` collection existed; nothing read or wrote them.

## Decision

Two PRs. The proposal side lands first, behind ports; findings storage follows.

**PR A (AI-100, medium risk):**

| Part            | What                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReviewFinding` | repo, PR number, reviewer role, severity, `kind` (a slug, `^[a-z][a-z0-9-]{0,39}$`), title, file, head SHA, time.                                                                                                                                             |
| Ports           | `ReviewFindingSource.recent(projectId, {maxPulls, maxFindings})`; `ConfigChangeStore` (`createPending`, `get`, `list`, `reject`). Fakes and contract suites; a Firestore adapter for the store. No method moves a change to `applied`.                        |
| ConfigChange    | Additive, defaulted fields: `projectId`, `dedupeKey`, `decidedBy`, `decidedAt`. No `SCHEMA_VERSION` bump, no rules or index change (equality queries only).                                                                                                   |
| Rule (domain)   | Over the project's 20 most recently reviewed PRs, a kind on 3+ distinct PRs (ticket assumption) yields one pending change: entity `agent_config`, target `AGENTS.md`, a templated section naming the kind and PRs, up to 3 example titles.                    |
| Duplicates      | `dedupeKey` = project + file + kind; `createPending` returns the existing pending change instead of writing (in a transaction). A rejected proposal may come back if the kind keeps repeating.                                                                |
| Caps (ADR-0028) | 500 findings read and 5 new proposals per sweep; 10 pending per project; 50 per list; 4,000 characters of proposed text.                                                                                                                                      |
| Untrusted text  | Only the kind slug and PR numbers shape the proposal. Titles are flattened to one line (no control or format characters, `<>`, backticks, `@`, `\|`), cut to 120 characters, and quoted as "reviewer text, unverified".                                       |
| API             | Under `/api` (sign-in + allow-list): `POST /api/projects/{id}/config-proposals/sweep`, `GET /api/config-changes`, `POST /api/config-changes/{id}/reject` (owner only, `decide_config_change`). The source returns nothing until PR B, so sweeps propose none. |

**PR B (high risk, Andy merges):** the review workflow posts each verdict's findings to the control plane over the Actions OIDC callback pattern (ADR-0019); a `kind` field from a fixed list in both review schemas and procedures; the Firestore adapter for `ReviewFindingSource`; caps and a rate limit on the new entry point; threat-model rows. The weekly system review then calls the sweep.

**Accepting** (applying the text to `AGENTS.md` through a PR) is M4 config editing. Until then Andy copies accepted text by hand and rejects the rest.

## Consequences

- Acceptance criteria 1 (create on 3+ PRs) and 3 (no duplicate) are built and tested on fakes, but live only with PR B; criterion 2 (never applied without Andy) holds now: no code path applies a change.
- v1 always targets `AGENTS.md`; mapping kinds to a procedure file can come later through the same `diff.file`.
- AI-118: M4.11: Config change log builds on `ConfigChangeStore` (adds the applied-change writer).
