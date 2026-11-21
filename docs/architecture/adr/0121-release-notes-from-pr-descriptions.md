---
title: Release notes from a block in each PR description
status: proposed (AI-159; Andy decides at review)
date: 2026-11-20
---

# 0121 — Release notes come from a fixed block in each PR description, stored on merge

AI-159: What's new: a short release-notes and project-status page fed by merged PRs.

## Context and Problem Statement

Andy stopped reviewing each PR (2026-11-20): he wants to keep up with what was built and how it works from one page, with succinct summaries, because the rate of change is high. Where does each change's summary come from, where is it stored, and what checks it?

## Considered Options

1. A `CHANGELOG.md` edited by every PR. Every PR edits the same file: conflicts all night.
2. Summaries written by a model after each merge. Costs an agent task per merge; the author knows best; out of scope in the ticket.
3. A fixed block in the PR description, checked by CI, parsed and stored by the control plane when the PR merges.

## Decision Outcome

Option 3.

- **Block:** `What changed:` (one sentence, ≤ 25 words), `How it works:` (≤ 45), optional `Needs you:` (≤ 25). One parser, `packages/domain/src/release-note.ts`; the `release-note` check (`release-note.yml` → `platform/actions/release-note-check`) imports the same file with Node's type stripping, and re-runs when the description is edited. Dependabot PRs are skipped. Not yet a required check: Andy adds it to the ruleset once open PRs carry the block.
- **Storage:** the webhook, on a PR merged into the default branch (first delivery only, like ticket moves), reads the PR's description, merger and changed files from the code host (new `CodeHost.getPullRequestDetails`) and puts one `ReleaseNote` at `projects/{p}/releaseNotes/pr-<n>`: the three fields (cut to 400 characters), PR, ticket key, title and risk, merge time, merger login, and links to the `docs/features/`, ADR and runbook files it touched (≤ 10). A PR with no block is stored by title, `no_note`. A failure is logged, never retried.
- **Reads:** `GET /api/projects/{p}/whats-new` and MCP `whats_new` (`since`, `until`, `epic`; 14 days by default, at most 90; ≤ 200 notes). The window query orders and filters on `mergedAt` alone, which Firestore's automatic single-field index serves: no composite index, no rules change, no `SCHEMA_VERSION` change. Status counts come from the project's tickets per top-level epic (AI-148's milestone map wasn't on `main`; later reads can share it).
- **Trust:** note text is the PR author's (often an agent's): untrusted, capped, rendered as plain text, never given to an agent as instructions.
- **Backfill:** `apps/api/src/backfill-release-notes.ts`, run once by hand (runbook `whats-new-backfill.md`), writes `backfill` notes for PRs merged since 2026-11-10; never overwrites.

### Consequences

- Good: no shared file; the page is current the moment a PR merges; the digest links it instead of repeating it.
- Good: one parser for the check and the store, so they never disagree.
- Bad: a note is only as good as its author; the caps keep it short, not right. Review agents read the block like the rest of the description.
- Bad: an edit to the description after the merge isn't picked up (a redelivery is a no-op).
