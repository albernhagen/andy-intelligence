---
status: accepted
date: 2026-11-02
---

# 0038 — Project baseline is carried by composite actions, a manifest, and a local apply script

Decided by Andy, 2026-11-02 (M1.16: Project baseline v1). Supersedes the "CI and security workflows" row of ADR-0031: Project baseline; the rest of ADR-0031 stands.

## Context and Problem Statement

ADR-0031 planned reusable workflows in `platform/workflows/`, pinned by SHA, with scripts and procedures checked out from that SHA. Checked before building:

- GitHub only runs reusable workflows from `.github/workflows/` (no subfolders), so `platform/workflows/` can't work.
- A reusable workflow's check is named `<caller job> / <job>`. The `protect-main` ruleset requires exact names (`check`, `security-review`, …), the same constraint ADR-0037 hit.
- A called workflow sees the **caller's** `github` context, so it can't easily find its own commit to load scripts and procedures from.
- A composite action knows its own location (`GITHUB_ACTION_PATH`): when a repo uses `albernhagen/andy-intelligence/platform/actions/X@<sha>`, the runner downloads this repo at `<sha>`, so `$GITHUB_ACTION_PATH/../../..` is this repo at the pinned commit.

## Decision Outcome

| Question             | Decision                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared steps         | **Composite actions in `platform/actions/`**, one per required check (`ci-check`, `actionlint`, `terraform-check`, `secret-scan`, `codeql`, `dependency-review`, `terraform-misconfig`) plus `agent-review-{prepare,finish}` (moved from `.github/actions/`). Scripts and procedures are read from the action's own commit.                         |
| Callers              | Thin workflows in `.github/workflows/` keep triggers, permissions, timeouts, concurrency and the **job names** (= required checks). The review agent step stays in the caller (ADR-0037). Ruleset unchanged.                                                                                                                                        |
| This repo            | Calls the actions locally (`./platform/actions/X`), so a change is tested in its own PR. Review procedures and schemas still come from the base branch (threat-model risk R5 stays open for this repo only).                                                                                                                                        |
| Managed repos        | Get this repo's caller workflows with `./platform/actions/X` rewritten to `albernhagen/andy-intelligence/platform/actions/X@<sha> # <ref>`. Procedures come from the pinned commit, so a PR can't weaken its own review (closes R5 for them).                                                                                                       |
| Files                | `platform/baseline/manifest.json` lists every file and its kind: **managed** (kept identical; drift reported), **lines** (`.gitignore` lines that must exist), **seed** (written once: `AGENTS.md`, threat model), **starter** (only into a repo with no `package.json`). Sources are this repo's own files where they're shared, else `template/`. |
| GitHub config        | JSON in `platform/baseline/github/` (repo merge settings, security & analysis, Actions permissions incl. required SHA pinning, labels, `protect-main` ruleset). Applied by `platform/baseline/baseline.mjs` with Andy's `gh` login (admin). Never in CI.                                                                                            |
| Drift                | `baseline.mjs check` (Andy, local): every setting + managed files vs `.andy/baseline.json`. Weekly system security review: labels and ruleset only, because the job token can't read security & analysis or Actions settings. Full weekly drift moves to the GitHub App (M1.5: GitHub App + project registration).                                  |
| Versions and updates | Tags `vX.Y.Z` on this repo. Dependabot bumps the action pins; `check` then flags pins newer than `.andy/baseline.json`, and `baseline.mjs files --ref <tag>` opens a PR that updates every managed file and the record together.                                                                                                                    |
| Stack                | v1 assumes Andy's standard stack (pnpm, Node, TypeScript, ADR-0009). `terraform` checks pass with a notice when a repo has no `infra/`.                                                                                                                                                                                                             |

### Consequences

- Good: check names and the ruleset are unchanged; one pin per action; managed repos review with rules they can't edit; `apply --dry-run` and `check` show exactly what differs.
- Bad: triggers, permissions and job layout live in each repo's caller files, so changing them needs a `files` update PR, not just a pin bump; a Dependabot pin bump alone leaves other managed files stale until `files` runs (drift says so); this repo keeps R5; the apply script runs with Andy's admin login (a new credential use, in the threat model).
