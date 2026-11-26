# PR re-sync

When `main` moves, GitHub merges it into other open same-repo PRs that merge cleanly; their checks rerun. The review agents won't run on a bot's push, so each review keeps its earlier verdict when the PR's own diff is unchanged; otherwise its check fails until someone pushes (ADR-0140). A conflict gets one comment on the PR naming the files. Skips drafts, forks, agent PRs (sync tasks keep those current) and PRs labelled `no-auto-sync`. Capped: 12 runs that re-synced an hour, 20 PRs a run, 3 per PR a day (ADR-0111, ADR-0139).

Runs only for a project whose PR sync setting is `all` (AI-388, ADR-0157): the workflow first asks the control plane (`POST /github/pr-sync`, with its Actions OIDC token) and on `queue`, the default, ends with no write, since the merge queue syncs the PR that is next.

**How to use:** Settings → Automation → "Keep open PRs up to date": `Every open PR` (or MCP `set_pr_sync`), and the repo variable `RESYNC_PRS=on`, which stays the pause switch (runbook `../runbooks/coordinating-sessions.md` §6). Label a PR `no-auto-sync` to keep it out.
