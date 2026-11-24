---
title: "UI PRs carry a before-and-after table; the release-note check enforces it"
status: accepted (Andy, 2026-11-23; AI-353)
date: 2026-11-23
amends: 0121 (the release-note check gains a screenshot rule), 0059 (UI changes show their screens in the PR)
---

# 0153 — UI PRs carry a before-and-after table of their changed screenshots

AI-353: UI PRs show before and after screenshots, under AI-357: Design and UX. Andy, 2026-11-23: "any PR that affects UI should show the screenshots of before/after and same for design-based milestones". Andy's decision, on those words (ticket AI-353); proposed in the 2026-11-23 design review (`docs/build-log/2026-11-23-design-review.md`).

## Context

The `ui-screenshots` check (Playwright, ADR-0045) fails on a diff from the stored images, which UI PRs commit to `apps/web/e2e/__screenshots__/`. Before and after were visible only in GitHub's Files tab, image by image. The repo is public, so both versions of a changed image already have a URL: the raw file at the base commit and at the head commit.

## Decision

| Part              | What                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table             | `pnpm screenshots:table` (`scripts/screenshot-table.mjs`): one row per added, changed or removed stored image, base and head raw URLs pinned to commit SHAs (true after the branch is deleted); `--write` puts it between markers in the PR description with `gh` |
| Rule              | The release-note check (ADR-0121) fails a PR into the default branch that changes a stored image without an after image for it in the table, and says how to add it                                                                                               |
| Flag              | A PR that changes the web source (`apps/web/src`; action input `ui-src`) and no stored image gets a warning: an annotation and a job-summary line, not a failure                                                                                                  |
| Summary           | The check prints the table, rebuilt from the validated rows, to its job summary                                                                                                                                                                                   |
| Design milestones | No extra step: each Done ticket's PR carries its table, so a milestone's screens read from its PRs                                                                                                                                                                |

- No new workflow permission and no bot comment: the job lists the PR's files with its own `contents: read` token (retried without it if refused). Never `pull_request_target`.
- The description is untrusted: strict row parsing, nothing reaches a shell (`docs/security/review-pipeline.md`).
- A table from an older commit than the head passes with a warning (rerun the script); requiring the exact head would fail every later push.

## Managed projects

Through the baseline action `platform/actions/release-note-check` (ADR-0038), when the release-note check is carried. A public repo gets the same rule. A private repo skips it: raw URLs need sign-in and don't render in a PR description, so the source of images for private repos is open.

## Consequences

- Every UI PR into `main` after this merges needs the table; PRs stacked before it add theirs when retargeted.
- Bodies of ADR-0121 and ADR-0059 are unchanged; their status lines note this amendment.
