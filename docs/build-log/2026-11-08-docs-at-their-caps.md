# Docs at their word caps split (AI-35: Docs at their word caps: features catalog, threat model by area, workflow doc)

Three always-loaded docs sat within a few words of their budgets, so every PR had to trim another's line. Split under ADR-0046 and ADR-0061; no cap raised, paragraphs moved verbatim.

| Doc                             | Moved to                                                               | Words (before → after) | Cap   |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------- | ----- |
| `README.md`                     | Per-feature rows → `docs/features.md`                                  | 2,000 → 1,472          | 2,000 |
| `docs/security/threat-model.md` | Trust boundaries and credentials → four area files in `docs/security/` | 3,598 → 2,325          | 3,600 |
| `docs/architecture/workflow.md` | As-built notes → `docs/architecture/history/workflow-as-built.md`      | 1,298 → 1,011          | 1,300 |

New budgets: `docs/features.md` 1,500; `docs/security/*.md` 900 each.

Open: the per-PR security review gets only the main threat-model file from the base branch; area files come from the PR's own tree (noted in `platform/procedures/security-review.md`). Passing them from the base needs a workflow change Andy approves.
