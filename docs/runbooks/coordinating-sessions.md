# Coordinating parallel sessions in Claude desktop — runbook

How the procedure [`platform/procedures/coordinate.md`](../../platform/procedures/coordinate.md) is run for this repo today: a coordinator session in the Claude desktop app (Code tab) starts one worker session per ticket. Until M2: Self-hosting: andy-intelligence builds itself, this is how several tickets get built at once. The procedure holds the rules; this page holds only what is specific to the app and this repo.

| Term        | Meaning                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Coordinator | The session Andy talks to. Starts workers, reads their PRs, tells Andy what to merge. Pinned, so auto-archive never closes it. |
| Worker      | A session started by the coordinator for one ticket, in its own git worktree, on its own branch.                               |
| Upkeep      | A small worker with no worktree that only moves, cancels and answers on tickets over MCP.                                      |

**First, whenever sessions stall or tests time out:** `node scripts/coordinator/host-check.mjs`. A closed lid or a sleeping Mac freezes every session, and on waking it looks like failing tests (2026-11-16 to 11-20: four days lost). It checks the lid (`ioreg -r -k AppleClamshellState -d 4`), power, sleeps in `pmset -g log`, load and a 20 ms timer test, and prints one verdict. `HOST PROBLEM` means fix the Mac (open the lid, plug in, stop some sessions) before blaming the code.

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
| Coordinator merges clean PRs               | Only through MCP `merge_pr`, by the project's merge mode (§5, ADR-0124).                          |

## 3. What the coordinator does that the procedure doesn't say

- **Tickets first, over MCP:** `create_ticket` with the milestone epic as `parentId` (AI-21: M1, AI-22: M2, AI-23: M3). Refine runs on each new ticket and may ask questions; a worker builds from the ticket and brief, not from those answers.
- **Milestone review (AI-281: Milestone review and approval before its work starts):** read each milestone's status from the product (MCP `list_milestones`; ADR-0131: Milestones) and start tickets only in an `approved` one. When approved work runs out, break the next milestone into tickets (backlog, under its epic) and ask Andy once, in the digest or a message, to approve or park it: a table of its tickets (key, title, size, depends on), the expected cost, and what it needs from him (secrets, accounts, `terraform apply`, decisions). Build none of it before his answer; a parked milestone's tickets stay in the backlog. Never set a status yourself (`set_milestone_status`) unless Andy says so in his own words.
- **Reserve ADR numbers** in each brief; the next free number is the highest `NNNN-*.md` in `docs/architecture/adr/` (`pnpm adr`) plus those already handed out.
- **Owned by the coordinator:** `context-budget.json` budgets. The milestone map is generated from tickets (MCP `milestone_map`); nobody edits it. Workers add only their own `docs/build-log/<date>-<slug>.md`.
- **Budgets:** architecture detail goes in the topic files (ADR-0061); a worker replaces the as-built lines it supersedes. A budget is raised only when Andy agrees, in a PR he merges.
- **After each merge:** `gh run list --branch main` for the checks on `main`; message every open worker; send the upkeep worker any ticket the PR event did not move.
- **Workers waiting on Andy** (a permission prompt inside the session) are named to him and left alone.
- **Infra:** a PR that needs `terraform apply` or a deploy sequence says so in its description; Andy applies locally, per root, with the expected counts (`infra/AGENTS.md`).
- **Sessions start only on Andy's turns.** The app refuses a session start on a turn a worker's note began; there the coordinator can only propose. Start the next batch while Andy is in the conversation.
- **Give the next ticket before merging.** A worker is archived the moment its PR merges (auto-archive). Anything more for that worker (a follow-up, a fix) goes to it before the merge; after it, a new worker.
- **Pushes:** the pre-push hook runs typecheck and only the tests the push affects (ADR-0113), on at most a quarter of the cores (AI-219); CI runs the full suite. Still release workers' pushes a few at a time, and run `host-check` when pushes slow down.

## 4. Hand over

Between batches, the coordinator writes `docs/build-log/<date>-handover-<milestone>.md` (merged, open, waiting on Andy, next batch) in a docs PR, and Andy starts the next coordinator with the message in §1.

## 5. Merging by the coordinator: only through `merge_pr` (ADR-0124)

The coordinator merges **only** through MCP `merge_pr` (AI-220: Merge modes: coordinator sessions merge through MCP merge_pr), never with `gh pr merge`, `merge-queue` or Andy's token. ADR-0078, ADR-0088, ADR-0092 and ADR-0120 no longer decide who merges; the project's merge mode does (project AI: `all-clean`). What they still decide: ADR-0092's table is the `low-risk` mode's high-risk list; ADR-0120's table of kinds Andy keeps is what `survey` reports, while `merge_pr` checks the kept list in `packages/domain/src/merge-paths.ts` (ADR-0124's kept kinds); ADR-0078 and ADR-0088 decide nothing now.

| Step    | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask     | `merge_pr` with the project key, repo (`owner/name`, one of the project's repos) and PR number. Only Andy's sign-in may call it.                                                                                                                                                                                                                                                                                                                                |
| Facts   | The control plane reads from GitHub, never from PR text: changed files, labels, the base branch's required checks and the head's checks, the base tip's sha and whether the head contains it, review findings, the ticket named by the head branch or the description's first line (only if its latest linked PR is this one) and its stage.                                                                                                                    |
| Verdict | `mergeVerdict` under the ticket's mode (the project's, or a stricter epic or ticket override), the same function the gate uses. **Clean**: every required check and both review agents passed on the head, head contains the latest `main`, no `review-accepted` / `security-accepted` label, no open finding, ticket in Ready for review, not a draft, into `main`, no kept path (`packages/domain/src/merge-paths.ts`; in `low-risk` also no high-risk path). |
| Merge   | Squash with the App's identity, pinned to the judged head. The base tip is read again just before: if `main` moved it answers `wait` (`behind_default_branch`); if the head moved GitHub refuses and it answers `mergeError`.                                                                                                                                                                                                                                   |
| Wait    | `verdict: "wait"` with every reason (`reasons`, plus `gateReasons` for checks, draft or branch). Fix and call again, or leave it for Andy.                                                                                                                                                                                                                                                                                                                      |
| Record  | Each merge, and each refused merge, is a comment on the ticket: PR, head, who asked, mode, verdict. Keep the digest table too.                                                                                                                                                                                                                                                                                                                                  |
| Cap     | 30 calls per project per hour (per instance; ADR-0028).                                                                                                                                                                                                                                                                                                                                                                                                         |

**Not covered:** build agents' PRs (`agent/…` branches; the gate merges them), PRs without a ticket in Ready for review, docs-only PRs whose review agents skipped ("not reviewed" is not a pass): these wait for Andy. **Andy keeps** the kept kinds in every mode: who merges, what judges a PR, what needs his hands (Terraform apply, a secret, an external account, an App permission) and an open finding or doubt; the kept list holds the paths, the last two stay judgement. Call such a PR ready only when it meets every condition above.

**Merge queue.** A clean PR, or one clean but behind `main`, goes into the repo's merge queue (AI-110: M5.18: Merge queue per repo, ADR-0150), shared with the gate across both instances. The call answers `merged`, or `queued` with `queuePosition` and `queueNote`; a queued PR merges later, after the re-sync workflow syncs it and its checks pass again. Calls may overlap. A PR dropped from the queue (checks failed, a cap) flags its ticket in Needs-you.

After each merge: `gh run list --branch main`. The merge starts **Re-sync open PRs** (`resync-prs.yml`, ADR-0111): it merges `main` into every open same-repo PR that merges cleanly, and their checks and both reviews rerun. Read its job summary (`gh run view <id>`): message only the workers whose PR shows `conflict`, `refused` or `error` (a conflict also leaves a comment naming the files) or `skipped` at a cap, to merge `main` and rerun. Agent PRs are left to sync tasks (ADR-0083); drafts, forks, Dependabot and PRs labelled `no-auto-sync` are left alone. Keep a running table of every merge (PR, ticket, who merged, review verdicts) in the milestone digest (`docs/build-log/<date>-digest-<milestone>.md`), which opens with a plain summary of what was built or changed.

## 6. Re-sync open PRs (ADR-0111)

| Step                                  | How                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn on (Andy, once, after the merge) | Create the label (or run `baseline.mjs apply`): `gh label create no-auto-sync --color C5DEF5`. Then `gh variable set RESYNC_PRS --body on`.                                                                                                                                           |
| Pause                                 | `gh variable set RESYNC_PRS --body off`. Runs still start on each merge and skip at once.                                                                                                                                                                                             |
| Caps                                  | 12 runs that re-synced an hour (counted from `main` merges on open PRs; skipped and capped runs don't count, ADR-0139), 20 PRs a run, 3 merges of `main` per PR a day.                                                                                                                |
| Keep one PR out                       | Label it `no-auto-sync` (a worker mid-change, a PR that must stay on an old `main`).                                                                                                                                                                                                  |
| Workers                               | Before pushing, `git pull --no-rebase` (the branch may hold a re-sync merge). Never rebase or force-push over it.                                                                                                                                                                     |
| Red run                               | A shared failure stops it before any PR; one PR's failure shows as `error` in the summary and the rest go on. The job log names the step: token refused (control plane down or `TOKEN_POLICY`), fetch failed, or the hourly cap (a warning, not red). Re-run from Actions once fixed. |

## 7. Coordinator tools (`scripts/coordinator/`)

Plain Node, tested, run from the repo root. `--help` on each. Keep throwaway scripts out of temp folders (one was wiped after four days): improve these instead.

| Tool          | What it does                                                                                                                                                                                                                                                                                                                                                                                                           | Changes remote state                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `survey`      | For the given PRs (default: all open): head, merge state, whether the head contains `main`, check counts and failing checks, each review agent's verdict line and blocking findings on that head, labels, and which paths the diff touches from ADR-0120's "Andy keeps" table and ADR-0092's "look hardest" list. `--json` too.                                                                                        | No                                   |
| `merge-queue` | Merges the listed PRs one at a time, only when `survey` finds nothing blocking (synced, every check passed, both verdicts on the head with zero blocker, should-fix, high and critical, no labels, no ADR-0120 "Andy keeps" path, file list read); waits for `main`'s runs after each and stops on any failure. `--dry-run`.                                                                                           | **Yes:** merges and deletes branches |
| `resync`      | Merges `origin/main` into a PR branch in a scratch worktree. Resolves a conflict only in Markdown where both sides purely added lines; otherwise aborts and lists the files for the worker. Installs without lifecycle scripts, runs `main`'s budget check, then pushes (no force) through the pre-push hook, which runs the branch's typecheck and tests; all three with no tokens in their environment. `--dry-run`. | **Yes:** pushes to the PR branch     |
| `host-check`  | Lid, power, recent sleeps, load, timer test; one verdict.                                                                                                                                                                                                                                                                                                                                                              | No                                   |

**Don't merge with `merge-queue`:** it merges with your GitHub token; merge only through `merge_pr` (§5). `survey` still helps decide what to send to `merge_pr`. `resync` is for a coordinator, never for build agents. `resync`'s push runs the branch's hook as you: no tokens in its environment, but that code can still reach your keychain's GitHub login, as the worker's own push can (`docs/security/agents-and-executors.md`). A failed GitHub call is never read as synced, green or reviewed. After one merge the rest of a queue are behind `main`: Re-sync open PRs (§6) or `resync` syncs them; wait for their checks and reviews, then queue again.

## 8. Running sessions in the cloud

Cloud sessions run at claude.ai/code on an Anthropic VM, included in the plan with the same usage limits. Every statement below marked _(untested)_ comes from Anthropic's docs on 2026-11-20; AI-151 replaces the marks with what a real session showed.

### Andy's steps, once (AI-150)

1. **Connect GitHub.** At claude.ai/code, connect GitHub and install the Claude GitHub App (github.com/apps/claude) on the `albernhagen` account with access to `andy-intelligence`.
2. **Environment.** New-session screen → environment selector under the message box → "Default" → settings icon. Setup script: `bash scripts/cloud-setup.sh`. Network access: "Limited", "Allow package managers" checked; add `storage.googleapis.com` under "Allowed domains" only if cloud workers should run the Firestore emulator suite. Environment variables and network secrets: empty; never put a secret there. "Save changes".
3. **Ticket connector.** The `andy-intelligence` connector connected in claude.ai (Customize → Connectors); approve its first tool call when a session asks.

Then Andy tells the coordinator "run AI-151 in the cloud".

### What the coordinator and workers do differently

- The coordinator starts a cloud worker only when Andy asks for the cloud in words.
- A cloud session starts from the branch on GitHub (the default branch from the web), never from unpushed local work: push first and name the branch in the brief. Idle VMs are reclaimed: history kept, background processes lost _(untested)_.
- Cloud workers send the coordinator no note when a turn ends: watch their PRs with `survey`.
- The cloud GitHub proxy rejects `gh pr` and `gh issue` (GraphQL) _(untested)_. Briefs say: open and read the PR with `gh api` (REST, for example `gh api repos/albernhagen/andy-intelligence/pulls -f head=... -f base=main -f title=... -f body=...`) or the session's "Create PR" button.
- `~/.claude/CLAUDE.md` and user-scope skills do not load; the repo's `AGENTS.md`, `.claude/settings.json` hooks and `.claude/skills/` do _(untested)_. Put everything a worker needs in the brief or the repo.
- The image has Node 22 (`.nvmrc` says 24; `package.json` accepts 22 or later), about 4 vCPUs and 16 GB _(untested)_: the full suite is slower than on the Mac.
- `scripts/cloud-setup.sh` (`corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`) needs no secret and fails loudly; it must finish in under five minutes so the environment caches it _(untested)_.
