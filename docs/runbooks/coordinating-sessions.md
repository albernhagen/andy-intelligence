# Coordinating parallel sessions in Claude desktop — runbook

How the procedure [`platform/procedures/coordinate.md`](../../platform/procedures/coordinate.md) is run for this repo today: a coordinator session in the Claude desktop app (Code tab) starts one worker session per ticket. Until M2: Self-hosting: andy-intelligence builds itself, this is how several tickets get built at once. The procedure holds the rules; this page holds only what is specific to the app and this repo.

| Term        | Meaning                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Coordinator | The session Andy talks to. Starts workers, reads their PRs, tells Andy what to merge. Pinned, so auto-archive never closes it. |
| Worker      | A session started by the coordinator for one ticket, in its own git worktree, on its own branch.                               |
| Upkeep      | A small worker with no worktree that only moves, cancels and answers on tickets over MCP.                                      |

## 1. Start a coordinator (Andy)

New session in this repo, then pin it. First message, with the milestone filled in:

> Coordinate M<N>: <title> for andy-intelligence. Follow `platform/procedures/coordinate.md` and `docs/runbooks/coordinating-sessions.md`. Read `docs/build-log.md`, the latest handover entry in `docs/build-log/`, the MCP `status` overview and the open PRs, then propose the first batch.

A new session gets the MCP connector's current tools. A long-lived one keeps the tool list from the day it started: if `move_ticket` or `cancel_ticket` is missing, start a new coordinator or an upkeep worker rather than working around it.

## 2. Settings that matter

| Setting                                    | Value                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Auto-archive sessions when their PR closes | On (Settings → Claude Code). A worker is archived when its PR merges, so its PR must be complete. |
| Worker model and effort                    | Opus 5.5, medium, for building. Sonnet, low, for upkeep.                                          |
| Auto-fix on the coordinator's own PRs      | On per PR, when Andy says so.                                                                     |
| Coordinator merges clean PRs               | Low since 2026-11-08, medium since 2026-11-11, every clean PR since 2026-11-20 (§5, ADR-0120).    |

## 3. What the coordinator does that the procedure doesn't say

- **Tickets first, over MCP:** `create_ticket` with the milestone epic as `parentId` (AI-21: M1, AI-22: M2, AI-23: M3). Refine runs on each new ticket and may ask questions; a worker builds from the ticket and brief, not from those answers.
- **Reserve ADR numbers** in each brief; the next free number is the highest `NNNN-*.md` in `docs/architecture/adr/` (`pnpm adr`) plus those already handed out.
- **Owned by the coordinator:** the milestone map in `docs/build-log.md` and `context-budget.json` budgets. Workers add only their own `docs/build-log/<date>-<slug>.md`.
- **Budgets:** architecture detail goes in the topic files (ADR-0061); a worker replaces the as-built lines it supersedes. A budget is raised only when Andy agrees, in a PR he merges.
- **After each merge:** `gh run list --branch main` for the checks on `main`; message every open worker; send the upkeep worker any ticket the PR event did not move.
- **Workers waiting on Andy** (a permission prompt inside the session) are named to him and left alone.
- **Infra:** a PR that needs `terraform apply` or a deploy sequence says so in its description; Andy applies locally, per root, with the expected counts (`infra/AGENTS.md`).

## 4. Hand over

Between batches, the coordinator writes `docs/build-log/<date>-handover-<milestone>.md` (merged, open, waiting on Andy, next batch) in a docs PR, and Andy starts the next coordinator with the message in §1.

## 5. Merging by the coordinator (ADR-0120)

Andy authorised the coordinator to merge low-risk PRs (2026-11-08, ADR-0078), medium-risk PRs (2026-11-11, ADR-0088) and, from 2026-11-20, every PR that passes its checks and reviews (ADR-0120): "I don't really need to merge individual PRs. I'm mostly rubber stamping them." `AGENTS.md` rule 2 says the same. AI-34: M1.8b: Gate and auto-merge builds the product's own version (`would_auto_merge`, vetoes, protected paths); its protected paths stay stricter.

The coordinator merges a PR when **all** hold on its current head:

| Condition | Check                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checks    | Every check green on the head commit (`gh pr checks`), required or not.                                                                                                                                                                                                                                                                                                                 |
| Reviews   | Both agents ran on that head and posted a verdict (`reviewed-sha` is the head) with no open `blocker`, should-fix, high or critical finding. A neutral check (agent skipped, unavailable or out of quota) does not count: docs-only PRs skip the agents (ADR-0030), so for them the coordinator reads the whole diff itself and records that. A fix clears a finding; a reply does not. |
| Synced    | Latest `main` merged in and everything rerun after it. Procedural only: the ruleset does not require branches to be up to date.                                                                                                                                                                                                                                                         |
| Labels    | No `review-accepted` or `security-accepted` label on the PR.                                                                                                                                                                                                                                                                                                                            |

**Andy keeps four kinds** (ADR-0120's table is the only list): what judges a PR (`.github/**`, `platform/actions/**`, `platform/baseline/**`, `CODEOWNERS`, the review scripts, procedures and schemas, the eval cases and runner), because a PR runs its own workflows and actions, so its green result proves nothing about a change to them; a change to who merges or to the coordinator's own rules (this runbook, `platform/procedures/coordinate.md`, `AGENTS.md` rule 2, an ADR about merging); a PR that only takes effect when Andy acts (Terraform to apply, a secret or credential, an external account, an App permission); and a PR with a finding open, an accepted label, or any doubt. These queue for Andy, verified, in merge order. ADR-0092's table is now where to look hardest, not who merges.

How: `gh pr merge <n> --squash --delete-branch`, one PR at a time; then `gh run list --branch main`. The merge starts **Re-sync open PRs** (`resync-prs.yml`, ADR-0111): it merges `main` into every open same-repo PR that merges cleanly, and their checks and both reviews rerun. Read its job summary (`gh run view <id>`): message only the workers whose PR shows `conflict`, `refused` or `error` (a conflict also leaves a comment naming the files) or `skipped` at a cap, to merge `main` and rerun. Agent PRs are left to sync tasks (ADR-0083); drafts, forks, Dependabot and PRs labelled `no-auto-sync` are left alone. Keep a running table of every merge (PR, ticket, who merged, review verdicts) in the milestone digest (`docs/build-log/<date>-digest-<milestone>.md`), which opens with a plain summary of what was built or changed.

## 6. Re-sync open PRs (ADR-0111)

| Step                                  | How                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn on (Andy, once, after the merge) | Create the label (or run `baseline.mjs apply`): `gh label create no-auto-sync --color C5DEF5`. Then `gh variable set RESYNC_PRS --body on`.                                                                                                                                           |
| Pause                                 | `gh variable set RESYNC_PRS --body off`. Runs still start on each merge and skip at once.                                                                                                                                                                                             |
| Keep one PR out                       | Label it `no-auto-sync` (a worker mid-change, a PR that must stay on an old `main`).                                                                                                                                                                                                  |
| Workers                               | Before pushing, `git pull --no-rebase` (the branch may hold a re-sync merge). Never rebase or force-push over it.                                                                                                                                                                     |
| Red run                               | A shared failure stops it before any PR; one PR's failure shows as `error` in the summary and the rest go on. The job log names the step: token refused (control plane down or `TOKEN_POLICY`), fetch failed, or the hourly cap (a warning, not red). Re-run from Actions once fixed. |
