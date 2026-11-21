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

| Setting                                     | Value                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Auto-archive sessions when their PR closes  | On (Settings → Claude Code). A worker is archived when its PR merges, so its PR must be complete. |
| Worker model and effort                     | Opus 5.5, medium, for building. Sonnet, low, for upkeep.                                          |
| Auto-fix on the coordinator's own PRs       | On per PR, when Andy says so.                                                                     |
| Coordinator merges low- and medium-risk PRs | Low since 2026-11-08, medium since 2026-11-11 (§5). High stays with Andy.                         |

## 3. What the coordinator does that the procedure doesn't say

- **Tickets first, over MCP:** `create_ticket` with the milestone epic as `parentId` (AI-21: M1, AI-22: M2, AI-23: M3). Refine runs on each new ticket and may ask questions; a worker builds from the ticket and brief, not from those answers.
- **Reserve ADR numbers** in each brief; the next free number is the highest `NNNN-*.md` in `docs/architecture/adr/` (`pnpm adr`) plus those already handed out.
- **Owned by the coordinator:** the milestone map in `docs/build-log.md` and `context-budget.json` budgets. Workers add only their own `docs/build-log/<date>-<slug>.md`.
- **Budgets:** architecture detail goes in the topic files (ADR-0061); a worker replaces the as-built lines it supersedes. A budget is raised only when Andy agrees, in a PR he merges.
- **After each merge:** `gh run list --branch main` for the checks on `main`; message every open worker; send the upkeep worker any ticket the PR event did not move.
- **Workers waiting on Andy** (a permission prompt inside the session) are named to him and left alone.
- **Infra:** a PR that needs `terraform apply` or a deploy sequence says so in its description; Andy applies locally, per root, with the expected counts (`infra/AGENTS.md`).
- **Sessions start only on Andy's turns.** The app refuses a session start on a turn a worker's note began; there the coordinator can only propose. Start the next batch while Andy is in the conversation.
- **Give the next ticket before merging.** A worker is archived the moment its PR merges (auto-archive). Anything more for that worker (a follow-up, a fix) goes to it before the merge; after it, a new worker.
- **Pushes:** the pre-push hook runs typecheck and only the tests the push affects (ADR-0113); CI runs the full suite. Still release workers' pushes a few at a time, and run `host-check` when pushes slow down.

## 4. Hand over

Between batches, the coordinator writes `docs/build-log/<date>-handover-<milestone>.md` (merged, open, waiting on Andy, next batch) in a docs PR, and Andy starts the next coordinator with the message in §1.

## 5. Auto-merge by the coordinator (ADR-0078, ADR-0088)

Andy authorised the coordinator to merge **low-risk** PRs itself (2026-11-08, ADR-0078) and **medium-risk** PRs too (2026-11-11, ADR-0088); `AGENTS.md` rule 2 carves out exactly these two classes. AI-34: M1.8b: Gate and auto-merge builds the same classification into the product (`would_auto_merge`, vetoes, protected paths, outcomes); keep the two aligned.

A PR is low risk when **all** hold:

| Condition | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checks    | Every check green on the head commit (`gh pr checks`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Reviews   | Both agents ran on that head and posted a verdict (`reviewed-sha` is the head) with no open `blocker`, should-fix, high or critical finding. A neutral check (agent skipped, unavailable or out of quota) does not count: docs-only PRs skip the agents (ADR-0030), so for them the coordinator reads the whole diff itself and records that in the merge table. A fix clears a finding; a reply does not. No `review-accepted` or `security-accepted` label on the PR.                                                                                 |
| Synced    | Latest `main` merged in and everything rerun after it. Procedural only: the ruleset does not require branches to be up to date.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Diff      | Confined to `apps/web`, `packages/domain`, `packages/store` read paths, read-only MCP tools, or these docs only: `README.md`, `docs/features/**`, `docs/build-log.md`, `docs/build-log/**`, `docs/architecture/history/**`. No `SCHEMA_VERSION` bump, migration, new entry point or credential. Also low risk, only when every row of ADR-0084's table holds (apply that table, not a summary): a lockfile-only fix for open Dependabot alerts, where the coordinator checks the alerts, versions and lockfile sources itself and reads the whole diff. |
| Size      | S or M.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Medium risk** (ADR-0088, Andy 2026-11-11) the coordinator also merges: the Checks, Reviews, Synced and Size rows above all hold and nothing in the diff is high risk. Apply ADR-0092's table, not a summary.

**High risk, so Andy merges:** everything in ADR-0092's high-risk table (CI and infra, access, data shape, the review system and executor sandbox, agent rules including this runbook, dependencies, docs-only decision changes, size L, doubt). That table is the only list; it is not repeated here so the two cannot drift. High-risk PRs queue for Andy, verified and listed in the digest in merge order.

How: `gh pr merge <n> --squash --delete-branch`, one PR at a time; then `gh run list --branch main`; then message every open worker to merge `main` and rerun. Keep a running table of every merge (PR, ticket, risk class, who merged, review verdicts) in the milestone digest (`docs/build-log/<date>-digest-<milestone>.md`), which opens with a plain summary of what was built or changed.

## 6. Coordinator tools (`scripts/coordinator/`)

Plain Node, tested, run from the repo root. `--help` on each. Keep throwaway scripts out of temp folders (one was wiped after four days): improve these instead.

| Tool          | What it does                                                                                                                                                                                                                                                                              | Changes remote state                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `survey`      | For the given PRs (default: all open): head, merge state, whether the head contains `main`, check counts and failing checks, each review agent's verdict line and blocking findings on that head, labels, and which paths from ADR-0092's high-risk table the diff touches. `--json` too. | No                                   |
| `merge-queue` | Merges the listed PRs one at a time, only when `survey` finds nothing blocking (synced, every check passed, both verdicts on the head with zero blocker, should-fix, high and critical, no labels); waits for `main`'s runs after each and stops on any failure. `--dry-run`.             | **Yes:** merges and deletes branches |
| `resync`      | Merges `origin/main` into a PR branch in a scratch worktree. Resolves a conflict only where both sides purely added lines; otherwise aborts and lists the files for the worker. Runs the budget check, then pushes (no force) through the pre-push hook. `--dry-run`.                     | **Yes:** pushes to the PR branch     |
| `host-check`  | Lid, power, recent sleeps, load, timer test; one verdict.                                                                                                                                                                                                                                 | No                                   |

`merge-queue` and `resync` are for a coordinator acting under ADR-0088, never for build agents. `merge-queue` never decides a PR's class: list only PRs you have classed low or medium (§5), and read high-risk paths in the survey as a prompt to apply ADR-0092 yourself. A failed GitHub call is never read as synced, green or reviewed. After one merge the rest of a queue are behind `main`: `resync` them, wait for their checks and reviews, then queue again.

## 7. Running sessions in the cloud

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
