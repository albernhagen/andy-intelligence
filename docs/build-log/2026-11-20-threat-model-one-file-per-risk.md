# 2026-11-20 — Threat model: one file per risk (AI-144)

AI-144: Threat model: one file per risk, table generated (epic AI-140: Parallel development without merge conflicts).

- **Why:** every trust-boundary PR edited one Prettier-padded risk table in `docs/security/threat-model.md` at its 3600-word cap. Open PRs always conflicted there, two that each fit pushed `main` over together (twice in November), and two PRs both took R27.
- **What:** the 32 risks (30 from the table, R25 and R26 from `closed-risks.md`, now deleted) are files `docs/security/risks/<ID>.md` with frontmatter `id`, `severity`, `status`, `owner`. `pnpm risks` (`scripts/risks.mjs`) prints the register; `pnpm test` fails on a malformed file or a reused id. No committed table, the same choice as AI-141 and AI-142: a generated committed table still conflicts.
- **Migration proof:** a one-off script read both tables from `origin/main` and compared every field of every row with its file: 32 rows, 32 files, all identical. The only text change after that is R9's mitigation, because the system review can now write new risk files.
- **Agents:** the per-PR security review gets the base branch's risk files in `.review/risks/` (`agent-review-prepare` now copies a folder). The system review may edit risk files and write new ones; its collect step still rejects anything else and any deletion. Read-only agents list risks with Grep (`^status:` in `docs/security/risks/`).
- **Budgets (Andy decides):** 300 words per risk file (largest today: R21, 239); `threat-model.md` lowered from 3600 to 1000 (now 732).
- **Not done:** the managed-project template (`template/docs/security/threat-model.md`) keeps its table; the procedures handle both layouts.
