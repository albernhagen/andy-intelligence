# Docs at their word caps split (AI-35: Docs at their word caps: features catalog, threat model by area, workflow doc)

Three always-loaded docs sat within a few words of their budgets, so every PR had to trim another's line. Split under ADR-0046 and ADR-0061; no cap raised, paragraphs moved verbatim.

| Doc                             | Moved to                                                               | Words (before → after) | Cap   |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------- | ----- |
| `README.md`                     | Per-feature rows → `docs/features.md`                                  | 2,000 → 1,472          | 2,000 |
| `docs/security/threat-model.md` | Trust boundaries and credentials → four area files in `docs/security/` | 3,598 → 2,325          | 3,600 |
| `docs/architecture/workflow.md` | As-built notes → `docs/architecture/history/workflow-as-built.md`      | 1,298 → 1,011          | 1,300 |

New budgets: `docs/features.md` 1,500; `docs/security/*.md` 900 each.

Keeping the trust-boundary and credential tables in the main file would not fit the target (register 1,730 + header 101 + tables 1,339 = 3,170 words, target 2,880), so `security-review.yml` now passes the four area files from the base branch as well (`context-files`), keeping the review's trusted anchor. Workflow change, so Andy merges.
