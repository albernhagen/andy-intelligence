# 2026-11-21 — Handover for Andy's product and architecture review

For a fresh session with no chat history. Facts come from MCP `milestone_map` and `status`, `git log origin/main` and `gh pr list`, read at 16:30 MST on 2026-11-21. "Today" means the 24 hours since 2026-11-20 17:00 MST, the overnight run included. Where neither gives a fact, it says **not verified**. Terms: a **project** holds **tickets**; a **milestone** is shown as an **epic** titled `M<N>: …` whose tickets are its work.

## 1. State of main and of each milestone

**Main** is at `3bd3d77` (AI-311: M4.38: Milestone status on the epic panel and board, PR #342): CI, UI screenshots, Firestore suite, security scans, secret scan and the control-plane deploy all passed. 119 PRs merged to main in those 24 hours.

**Scope Andy set today:** build M4, M5 and M10; park M6, M7, M8 and M9. AI-259: M10.12: OpenCode executor via Actions is out of M10 (his words: "we are just using claude code for the time being") and sits under no epic.

| Milestone (epic)                               | Done     | Built today                                                                                                                                             |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4: Epics + story board (AI-84)                | 34 of 41 | Milestones as their own level (entity, API and MCP, roadmap screen, dispatch only in approved milestones), roadmap data, morning report, Hallmark trial |
| M5: Multi-project in parallel (AI-82)          | 16 of 19 | AI-106: M5.3: Caller workflow for managed repos in the baseline                                                                                         |
| M10: Paid models + spend caps (AI-226)         | 14 of 19 | Spend design, ledger, gate, caps (project and global), panel and alerts, model gateway, direct-call steps, quota-aware route fallback                   |
| M6: Dev → prod releases (AI-153), parked       | 5 of 20  | Environment policy, deployment record, deploy events, DORA calculator and panel                                                                         |
| M7: Mobile (AI-168), parked                    | 9 of 18  | Installable app, phone shell, inbox, ticket detail, quota banner and pause, push policy and sender, gated PRs from the phone                            |
| M8: Project members (AI-18), parked            | 2 of 15  | AI-251: M8.2: Membership record and store; AI-252: M8.3: One project-access check                                                                       |
| M9: Add Jules + model routing (AI-225), parked | 9 of 16  | Routing config, compatibility rule, resolver, settings API, MCP and page, google-sub quota, revert, route layers (AI-282), Jules spike from docs        |

**Remaining tickets of the milestones being built:**

| Ticket                                                                             | Waits on                                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AI-128: M4.15: Every project has its own design file that agents follow            | Andy's merge, PR #311 (ADR-0132)                                                              |
| AI-205: M4.27: One glossary; retire the slice tables and the words slice and story | AI-307                                                                                        |
| AI-307: M4.37: Create project AI's milestones from the milestone epics             | Andy                                                                                          |
| AI-321: Milestone create and edit over MCP                                         | Andy merges (ADR-0136, proposed)                                                              |
| AI-127: M4.14: Non-blocking sloplint render report in CI                           | Andy's decision (recommended: cancel)                                                         |
| AI-129: M4.23: First overnight run trial                                           | Andy (which epic and budget)                                                                  |
| AI-208: M4.30: Agent-written "what changed" paragraph per epic                     | Not started                                                                                   |
| AI-110: M5.18: Merge queue per repo                                                | AI-220 (merge_pr), AI-284                                                                     |
| AI-113: M5.14: Baseline PR on registration                                         | Andy's decision (open decisions below)                                                        |
| AI-111: M5.4: First managed project live                                           | Andy: a second repo                                                                           |
| AI-65: Project planning baked into the flow                                        | Its open tickets: AI-113 (above) and AI-109: M5.16: Deploy scaffold, which waits on parked M6 |
| AI-260: M10.13: Capped API-key Claude provider                                     | Andy's merge, PR #296 (workflow)                                                              |
| AI-268: M10.17: Weekly model scout job                                             | Andy's merge, PR #303 (Terraform)                                                             |
| AI-266: M10.15: OpenRouter account, key and key limit                              | Andy                                                                                          |
| AI-267: M10.16: Claude API key and workspace spend limit                           | AI-260, then Andy                                                                             |
| AI-269: M10.18: First paid agent task under a cap                                  | AI-266                                                                                        |

Parked milestones keep their tickets; each waits first on its design PR: M6 on PR #227 (AI-156: M6.1: Releases design), M7 on PR #221 (docs: slice M7: Mobile into tickets, ADR-0115) and PR #249 (AI-179: M7.10: VAPID key secret), M8 on PR #267 (AI-242: M8.1: Project members design), M9 on PR #268 (AI-228: M9.1: Routing and Jules design) and PR #265 (AI-233: M9.9: Jules API key secret).

## 2. Work outside milestones today

| Area                          | What happened                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main kept green               | AI-283: Flaky Firestore test merged (PR #304). In review: AI-284: Require a PR to be up to date with main (PR #300), AI-143: Context budgets: two passing PRs can't push main over (PR #216), AI-219: Web tests time out when several sessions push at once (PR #331)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Firestore reads               | AI-315 (PR #313): a dispatch event 658 → 138 reads. AI-317 (PR #320): board after a write about 370 → 9. AI-318 (PR #334): dashboard, digest, epic status, What's new and milestone map. AI-319 (PR #339): Needs-you 110 → 4. The alert hour was 22,541 reads (limit 20,000). Measured by the coordinator at 11:36 MST from production: the new read-count log showed two dispatch passes at 61 reads each, and Firestore's own read metric showed 374 and 259 reads in the two ten-minute windows after the fix deployed (about 1,900 an hour), against about 1,000 per ten minutes for similar work before it and 22,541 in the alert hour. No burst as large as the alert's has happened since, so the worst case is not verified. |
| Web UI and MCP parity         | Epic AI-285: inventory (`docs/architecture/ui-mcp-parity.md`); AI-286 to AI-300 merged except AI-294: list and revoke runners over MCP (PR #327) and AI-299: ideate from the web UI; registry test AI-300 merged; new gap AI-320: start the project-plan and ideate agent tasks from the web UI and MCP                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Milestones as their own level | ADR-0131 (proposed, PR #307), AI-301 to AI-311; roadmap screen AI-202: M4.26                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Merge modes (AI-212)          | AI-214: the setting in contracts, API, MCP and settings UI merged (PR #310); AI-215: one merge verdict, the gate merges by the project's mode, in review (PR #328)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Design file per project       | AI-128, ADR-0132, in review (PR #311)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Hallmark trial                | AI-126: M4.13: verdict: drop it for this app (PR #312)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 3. Waiting on Andy

**Open PRs that are his to merge** (ADR-0120: who merges, what judges a PR, his hands, design ADRs):

| PR                           | Ticket and title                                                      | What merging does                                               | Afterwards                                                               |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| #328                         | AI-215: Merge modes: one merge verdict, the gate merges by mode       | The gate merges by each project's mode (who merges)             | Decide ADR-0134 (below)                                                  |
| #311                         | AI-128: M4.15: Every project has its own design file                  | ADR-0132; baseline and template gain `design.md`                | None beyond re-applying the baseline to managed projects when one exists |
| #300                         | AI-284: Require a PR to be up to date with main                       | Baseline ruleset requires up-to-date branches                   | Apply the ruleset change to the repo                                     |
| #299                         | AI-281: Milestone review and approval before its work starts          | Coordinator starts tickets only in approved milestones          | None                                                                     |
| #296                         | AI-260: M10.13: Capped API-key Claude provider                        | Workflow change; paid Claude provider behind a cap              | AI-267: the key and workspace limit                                      |
| #303                         | AI-268: M10.17: Weekly model scout job                                | Adds `infra/control-plane` resources                            | `terraform apply` in `infra/control-plane`                               |
| #309                         | AI-314: Terraform plan always shows a Cloud Run revision change       | `infra/control-plane` change                                    | `terraform apply` in `infra/control-plane`                               |
| #216                         | AI-143: Context budgets: two passing PRs can't push main over         | Changes a check that judges PRs                                 | None                                                                     |
| #331                         | AI-219: Web tests time out when several sessions push at once         | Changes the pre-push hook, which is carried to managed projects | None                                                                     |
| #327                         | AI-294: Parity: list and revoke runners over MCP                      | On hold for his ADR-0089 decision; if yes, ships with ADR-0135  | None                                                                     |
| #186                         | AI-100: Store review findings (part 2)                                | Review scripts, evals, workflows                                | None; re-synced at 16:35; check for new conflicts before merging         |
| #240                         | AI-134: Agent-task steps plan-project and ideate                      | Executor workflow change                                        | Re-synced at 16:35; check for new conflicts before merging               |
| #268, #267, #227, #221, #218 | Design ADRs for parked M9, M8, M6, M7, and ADR-0116: Dependency agent | Records proposed designs                                        | #268 and #267 need a sync                                                |
| #265, #249                   | AI-233: Jules key secret (M9), AI-179: VAPID key secret (M7)          | Secrets and Cloud Run env                                       | `terraform apply`; parked, can wait                                      |

**Open decisions** (question, then the recommended answer):

| Question                                                                            | Recommended                                                             |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| AI-113: M5.14: how does a new repo get the baseline workflows?                      | The App opens the PR without workflows; Andy adds them with one command |
| ADR-0134 (PR #328): should a should-fix finding fail the merge gate's review check? | Yes, fail the check                                                     |
| PR #327 (ADR-0089): list and revoke local runners over MCP?                         | Yes                                                                     |
| Re-sync cap `MAX_RUNS_PER_HOUR` = 4 in `scripts/resync-prs.mjs`: change it?         | Raise to 12; don't count skipped runs                                   |
| AI-127: M4.14: sloplint report in CI?                                               | Cancel                                                                  |
| Permission rules for `mcp__ccd_pr__bind_pr` and `mcp__ccd_pr__set_monitor`?         | Allow both, so Auto-fix can always be turned on                         |

**His alone:** create project AI's milestones (AI-307); the first overnight run trial (AI-129); a second repo for AI-111; the OpenRouter and Claude API keys (AI-266, AI-267, AI-269); the What's new backfill (runbook `whats-new-backfill.md`) and making `release-note` a required check; `terraform apply` of `infra/control-plane` for PR #217 (AI-136: Alert when a config change is not recorded) and for the Terraform PRs above once merged.

## 4. What went wrong today

| What                                                                                                              | Fix or open ticket                                             |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Main red: PR #226 (AI-148) merged behind main                                                                     | Fixed by PR #293; prevented by AI-284 (PR #300)                |
| Main red twice: word budgets broken when several green PRs merged together                                        | Fixed by PR #306 and PR #332; prevented by AI-143 (PR #216)    |
| Main red: a flaky Firestore test                                                                                  | AI-283 (PR #304, merged)                                       |
| An unattended night stalled for seven hours: the app stops waking a coordinator after many worker-triggered turns | A timed self-check every 30 minutes in the coordinator session |
| Two sessions edited the same tickets: the coordinator assigned one design twice                                   | Not verified beyond the coordinator's report; no ticket        |
| A bug merged in AI-306 (nested epics held by dispatch)                                                            | Fixed 45 minutes later by PR #340                              |
| The coordinator approved two extra MCP tools without an ADR                                                       | Split out after a reviewer flagged it                          |
| Auto-fix refused by the app's permission check in about half the sessions                                         | Decision above (permission rules)                              |
| Parallel PRs kept conflicting in shared docs, registries and screenshots                                          | Open; review question below                                    |
| The Mac's load reached 100 while many sessions pushed                                                             | AI-219 (PR #331); push only under load 40                      |

## 5. Questions for the review

- Is the per-instance ticket snapshot (ADR-0133: Board and ticket list read changed tickets) the right read model as projects grow?
- Should the control plane's dispatcher and merge gate now replace desktop coordinator sessions (merge modes AI-212, merge queue AI-110, milestone approval AI-281)?
- Are word budgets on shared docs worth their merge conflicts?
- What stays in M4 and what moves to Later?
- Terminology clean-up: AI-205: M4.27: One glossary.
- Which parked milestone, if any, comes next?
