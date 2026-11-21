# What's new: one-off backfill

Gives the What's new page (AI-159, ADR-0121) notes for PRs merged before PR descriptions carried the release-note block. Run once, after the AI-159 PR is deployed. Safe to re-run: it never overwrites a stored note.

| Step       | Command or action                                                                                                                                                                  | Expect                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Sign in | `gcloud auth application-default login`; `gh auth status`                                                                                                                          | Both signed in as you                                                           |
| 2. Dry run | `GOOGLE_CLOUD_PROJECT=<control-plane project> pnpm --filter @andy/api exec tsx src/backfill-release-notes.ts --project ai --repo albernhagen/andy-intelligence --since 2026-11-10` | One line per merged PR (`PR #n · AI-x · What changed`), then `Dry run: N notes` |
| 3. Write   | The same command with `--apply`                                                                                                                                                    | `Wrote N; skipped M PRs that already had a note`                                |
| 4. Check   | Open `/p/ai/whats-new`, 30 days                                                                                                                                                    | Old PRs listed, marked "Backfilled"                                             |

- "What changed" is the PR's block when it has one, else the first sentence of its summary (cut to 25 words), else its title.
- Reads: up to 300 PRs with your `gh` login. Writes: Firestore `projects/ai/releaseNotes/pr-<n>`, with your Application Default Credentials (needs Firestore write on the project).
- Undo: delete the `backfill` documents in that collection (console, filter `source == backfill`).
