# Project template (project baseline)

Files a managed repo gets at onboarding (ADR-0031: Project baseline, ADR-0038: Baseline carried by composite actions). Which file goes where, and how it is checked, is in `platform/baseline/manifest.json`. Runbook: `docs/runbooks/onboard-a-repo.md`.

| Folder / file        | Kind                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| `.github/`           | Managed: kept identical to the baseline; drift is reported            |
| `gitignore.lines`    | Lines: must be present in the repo's `.gitignore`; others are its own |
| `AGENTS.md`, `docs/` | Seed: written once if missing, then the project owns them             |
| `starter/`           | Starter: written only into a repo without `package.json`              |

Workflows, `lefthook.yml`, `.claude/settings.json` and `scripts/format-edited-file.mjs` aren't copied here: the baseline takes them from this repo's own files, so this repo and every managed repo run the same thing.
