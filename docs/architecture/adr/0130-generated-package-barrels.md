---
title: "Generated package barrels: exports.gen.ts from the folder, not committed"
status: accepted (Andy, 2026-11-25)
date: 2026-11-20
amends: 0110 (Barrels bullet)
---

# 0130 — Package barrels are generated from their folder and git-ignored

AI-277: Sorted export lines in index files still conflict between parallel PRs (epic AI-140: Parallel development without merge conflicts).

## Context and Problem Statement

ADR-0110 sorted the `export … from` lines in the package index files so inserts land in different places. Two PRs that each add a module next to the same neighbour still edit adjacent lines, and GitHub reports a conflict (PR #271, #274, #277, #238, #235). Each costs a worker re-sync plus a full CI and review cycle.

## Considered Options

1. `.gitattributes merge=union` on the index files, plus a sorted/no-duplicate test. Local `git merge` honours it, but GitHub's mergeability check and its merge button don't (community discussion #9288, still open in 2026; GitLab and Bitbucket report the same). The PR still shows a conflict, so the re-sync remains.
2. Generate each barrel from the files in its folder; commit the output. Two PRs still edit adjacent lines of the committed file.
3. Generate each barrel; don't commit it (like `api.gen.ts`, ADR-0110).

## Decision Outcome

Option 3, the only one that removes the shared edit.

- `scripts/gen-exports.mjs` writes `exports.gen.ts` in `packages/domain/src`, `packages/store/src` and `packages/contracts/src/{entities,fakes,ports,testing}`: one `export * from "./<module>"` per sibling `.ts` file (not tests, `index.ts`, `*.gen.ts`, `*.d.ts`, subfolders or the folder's internal list), sorted. It writes only when the content changed, through a rename.
- Each `index.ts` keeps its own code and one line, `export * from "./exports.gen";`.
- It runs on `pnpm install` (root `postinstall`; Docker, CI, IDE), first in root `lint`, `typecheck`, `test`, `build` and `test:firestore` (installs with `--ignore-scripts`: the agent executor), and before the Playwright web server. No workflow changes.
- Internal modules (domain: `config-changes`, `errors`, `night-budget`, `replan`, `test-executor`) are listed in the script, as they were left out of the hand-written barrel; `night-budget` would clash with `night-end`.
- `store` moved from named re-exports to `export *`: its public surface gains `deploymentKey` (`pnpm --filter @andy/api snapshot`, otherwise identical).
- `packages/contracts/src/index.ts` stays hand-written: five lines that pick subfolders and leave out `testing`, edited once since 2026-11-01.
- Tests (`scripts/gen-exports.test.mjs`): file selection, idempotence, two branches adding neighbour modules merge with no conflict, and each index re-exports only the generated file once (no hand list returns). The ADR-0110 registries test no longer checks barrels.

## Consequences

- Good: adding an exported module edits no shared file; barrels can't miss or repeat a module.
- Bad: a fresh checkout without `pnpm install` has no barrels, so tooling errors until it runs; a new file needs a rerun (`pnpm gen:exports` or any root check) before the editor sees it; `export *` makes every exported name in a module public, and a name clash between two modules fails `tsc` (TS2308) instead of being picked by hand.
