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
| Coordinator merges low-risk PRs            | Yes, since 2026-11-08 (§5). Medium and high stay with Andy.                                       |

## 3. What the coordinator does that the procedure doesn't say

- **Tickets first, over MCP:** `create_ticket` with the milestone epic as `parentId` (AI-21: M1, AI-22: M2, AI-23: M3). Refine runs on each new ticket and may ask questions; a worker builds from the ticket and brief, not from those answers.
- **Reserve ADR numbers** in each brief; the next free number is the highest in `docs/architecture/adr/README.md` plus those already handed out.
- **Owned by the coordinator:** the milestone map in `docs/build-log.md` and `context-budget.json` budgets. Workers add only their own `docs/build-log/<date>-<slug>.md`.
- **Budgets:** architecture detail goes in the topic files (ADR-0061); a worker replaces the as-built lines it supersedes. A budget is raised only when Andy agrees, in a PR he merges.
- **After each merge:** `gh run list --branch main` for the checks on `main`; message every open worker; send the upkeep worker any ticket the PR event did not move.
- **Workers waiting on Andy** (a permission prompt inside the session) are named to him and left alone.
- **Infra:** a PR that needs `terraform apply` or a deploy sequence says so in its description; Andy applies locally, per root, with the expected counts (`infra/AGENTS.md`).

## 4. Hand over

Between batches, the coordinator writes `docs/build-log/<date>-handover-<milestone>.md` (merged, open, waiting on Andy, next batch) in a docs PR, and Andy starts the next coordinator with the message in §1.

## 5. Auto-merge by the coordinator (ADR-0078)

Andy authorised the coordinator to merge **low-risk** PRs itself (2026-11-08); ADR-0078 holds the decision and `AGENTS.md` rule 2 carves out exactly this class. AI-34: M1.8b: Gate and auto-merge builds the same classification into the product (`would_auto_merge`, vetoes, protected paths, outcomes); keep the two aligned.

A PR is low risk when **all** hold:

| Condition | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checks    | Every check green on the head commit (`gh pr checks`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Reviews   | Both agents ran on that head and posted a verdict (`reviewed-sha` is the head) with no open `blocker`, should-fix, high or critical finding. A neutral check (agent skipped, unavailable or out of quota) does not count: docs-only PRs skip the agents (ADR-0030), so for them the coordinator reads the whole diff itself and records that in the merge table. A fix clears a finding; a reply does not. No `review-accepted` or `security-accepted` label on the PR.                                                                                 |
| Synced    | Latest `main` merged in and everything rerun after it. Procedural only: the ruleset does not require branches to be up to date.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Diff      | Confined to `apps/web`, `packages/domain`, `packages/store` read paths, read-only MCP tools, or these docs only: `README.md`, `docs/features.md`, `docs/build-log.md`, `docs/build-log/**`, `docs/architecture/history/**`. No `SCHEMA_VERSION` bump, migration, new entry point or credential. Also low risk, only when every row of ADR-0084's table holds (apply that table, not a summary): a lockfile-only fix for open Dependabot alerts, where the coordinator checks the alerts, versions and lockfile sources itself and reads the whole diff. |
| Size      | S or M.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Never low risk, so **Andy merges**: `.github/`, `platform/**` (procedures, actions, baseline, executor), `scripts/executor-*`, `infra/`; auth or permissions (AI-19, settings setters); the dispatcher or gate (AI-34); `packages/contracts` schemas the executor reads; Firestore rules or `SCHEMA_VERSION`; deploy or release paths; anything needing `terraform apply`; the agent rule files (`AGENTS.md`, `CLAUDE.md`, `docs/BUILD-PROMPT.md`, `.claude/**`), `context-budget.json`, `CODEOWNERS`, dependency changes outside ADR-0084 (a major jump, a new dependency, `scripts`), and every other file under `docs/`: `docs/security/**`, ADRs, `docs/architecture/*.md` (the design source of truth) and `docs/runbooks/**` (steps Andy runs by hand), including `platform/procedures/coordinate.md` and this runbook (the coordinator never merges a change to its own authority); any PR where a reviewer or the coordinator is unsure. When unsure, it is medium.

How: `gh pr merge <n> --squash --delete-branch`, one PR at a time; then `gh run list --branch main`; then message every open worker to merge `main` and rerun. Keep a running table of every merge (PR, ticket, risk class, who merged, review verdicts) in the milestone digest (`docs/build-log/<date>-digest-<milestone>.md`).
