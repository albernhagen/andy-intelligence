# PR re-sync

When `main` moves, GitHub merges it into other open same-repo PRs that merge cleanly; their checks rerun. The review agents won't run on a bot's push, so each review keeps its earlier verdict when the PR's own diff is unchanged; otherwise its check fails until someone pushes (ADR-0139). A conflict gets one comment on the PR naming the files. Skips drafts, forks, agent PRs (sync tasks keep those current) and PRs labelled `no-auto-sync`. Capped: 4 runs an hour, 20 PRs a run, 3 per PR a day (ADR-0111).

**How to use:** Automatic once Andy sets the repo variable `RESYNC_PRS=on` (runbook `../runbooks/coordinating-sessions.md` §6). Label a PR `no-auto-sync` to keep it out.
