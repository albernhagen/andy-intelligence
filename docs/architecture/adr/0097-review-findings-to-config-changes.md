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

| Part               | What                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReviewFinding`    | repo, PR number, reviewer role, severity, `kind` (a slug, `^[a-z][a-z0-9-]{0,39}$`), title, file, head SHA, time.                                                                                                                                                                                                                                                                                                                      |
| Ports              | `ReviewFindingSource.recent(projectId, {maxPulls, maxFindings})`; `ConfigChangeStore` (`createPending(change, maxPending)`, `get`, `listPending`, `decide`). Fakes and contract suites; a Firestore adapter for the store. No method moves a change to `applied`.                                                                                                                                                                      |
| ConfigChange       | New status `accepted` (Andy agreed; not applied). Additive, defaulted fields: `projectId`, `dedupeKey`, `decidedBy`, `decidedAt`. No `SCHEMA_VERSION` bump, no rules or index change (equality queries only).                                                                                                                                                                                                                          |
| Rule (domain)      | Over the project's 20 most recently reviewed PRs, a kind on 3+ distinct PRs (ticket assumption) yields one pending change: entity `agent_config`, target `AGENTS.md`, a templated section naming the kind and PRs, up to 3 example titles.                                                                                                                                                                                             |
| Duplicates and cap | One transaction per write checks both: a pending change with the same `dedupeKey` (project + file + kind) comes back instead of a new one, and a project at 10 pending gets none. Concurrent sweeps can't pass either. After Andy accepts or rejects a kind's proposal, only findings recorded after that decision count, so the kind comes back only if it recurs on 3 new PRs (20 decision lookups per sweep; kinds past that wait). |
| Caps (ADR-0028)    | 500 findings read and 5 new proposals per sweep; one sweep per project a minute (per instance); 10 pending per project, which also bounds the pending list (read complete, no read cap hiding any); 4,000 characters of proposed text.                                                                                                                                                                                                 |
| Untrusted text     | Only the kind slug and PR numbers shape the proposal. In titles, URLs become "link removed", then every character but letters, digits, spaces and `. , : ; ' ? % + / -` becomes a space: no Markdown, HTML, quote, mention or control character survives. Cut to 120 characters. The UI shows proposed text as plain text.                                                                                                             |
| Decisions          | Accept and reject are owner-only under the existing project-settings rule (`change_project_settings`: a config change is a project setting); `permissions.ts` is unchanged. Accepting records agreement and applies nothing.                                                                                                                                                                                                           |
| Surfaces (parity)  | REST under `/api` (sign-in + allow-list): sweep, list pending, accept, reject. MCP: `list_config_changes`, `sweep_config_proposals`, `accept_config_change`, `reject_config_change`. UI: a "Config proposals" section in the Needs-you inbox with "Check review findings", Accept and Reject. The finding source returns nothing until PR B, so sweeps propose none.                                                                   |

**PR B (high risk, Andy merges):** the review workflow posts each verdict's findings to the control plane over the Actions OIDC callback pattern (ADR-0019); a `kind` field from a fixed list in both review schemas and procedures; the Firestore adapter for `ReviewFindingSource`; caps and a rate limit on the new entry point; threat-model rows. The weekly system review then calls the sweep.

**Applying** an accepted change (the text into `AGENTS.md` through a PR) is M4 config editing. Until then Andy adds accepted text by hand.

## Consequences

- Acceptance criteria 1 (create on 3+ PRs) and 3 (no duplicate) are built and tested on fakes, but live only with PR B; criterion 2 (never applied without Andy) holds now: no code path applies a change, and accepting doesn't either.
- v1 always targets `AGENTS.md`; mapping kinds to a procedure file can come later through the same `diff.file`.
- AI-118: M4.11: Config change log builds on `ConfigChangeStore` (adds the applied-change writer).
