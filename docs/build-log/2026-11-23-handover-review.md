# 2026-11-23 — Handover for Andy's product and architecture review (update)

For a fresh session with no chat history. It replaces the state in [2026-11-21-handover-review.md](2026-11-21-handover-review.md); that file's "What went wrong" table still stands. Facts come from MCP `roadmap` and `status`, `git log origin/main` and `gh pr list`, read at 16:30 MST on 2026-11-23. Terms: [glossary](../architecture/glossary.md).

## 1. Where the build stands

The build is finished for now. Andy's order (2026-11-23): finish the build, do the product and architecture review in a new session, then try the system by creating the first managed project.

**Main** is at `40433e41` (AI-205: M4.27: One glossary; retire the slice tables and the words slice and story, PR #383). Its CI runs were still in progress when this was written: not verified green. No worker session is running.

Project AI now has eleven milestones (ADR-0131: Milestones), each with its epics attached:

| Milestone                                 | Status   | Tickets done |
| ----------------------------------------- | -------- | ------------ |
| M0: Foundations: repo, sign-in, GCP infra | approved | no epic      |
| M1 to M3                                  | approved | 38 of 38     |
| M4: Epics + ticket board                  | approved | 77 of 80     |
| M5: Multi-project in parallel             | approved | 38 of 46     |
| M10: Paid models + spend caps             | approved | 16 of 19     |
| M6: Dev → prod releases                   | parked   | 5 of 20      |
| M7: Mobile                                | parked   | 9 of 18      |
| M8: Project members                       | parked   | 2 of 15      |
| M9: Add Jules + model routing             | parked   | 9 of 16      |

**Open tickets in the approved milestones:**

| Milestone | Ticket                                                                 | What it is                                                           | Why it is open                                         |
| --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| M4        | AI-129: M4.23: First overnight run trial                               | Andy launches one real night run on a small epic under a budget      | After the review                                       |
| M4        | AI-347: Needs you counts the same unit everywhere                      | Header, inbox and work chip all count tickets, not questions         | Andy to decide                                         |
| M4        | AI-351: Parity: revoke a runner over MCP                               | Remove a local runner's access from Claude, not only the web UI      | Held: needs Andy's yes on the security rule (ADR-0089) |
| M5        | AI-111: M5.4: First managed project live                               | A second repo onboarded and built by agents                          | After the review                                       |
| M5        | AI-109: M5.16: Deploy scaffold for new projects                        | A new project gets its deploy setup as a standard step               | Waits on parked M6                                     |
| M5        | AI-110: M5.18: Merge queue per repo                                    | Clean PRs merge one at a time, each tested on the latest main        | Deferred to the review                                 |
| M5        | AI-220: Merge modes: coordinator sessions merge through MCP `merge_pr` | Desktop sessions merge by the same verdict as the gate               | Deferred to the review                                 |
| M5        | AI-216: Merge modes: epic PR mode                                      | Child tickets merge into an epic branch; Andy merges one PR per epic | Deferred to the review                                 |
| M5        | AI-217: Merge modes: GitHub enforces the kinds Andy keeps              | CODEOWNERS approval on the paths only Andy merges                    | Deferred to the review                                 |
| M5        | AI-150: Andy: connect GitHub and create the cloud environment          | Lets worker sessions run in Anthropic's cloud instead of on the Mac  | Andy's hands; not asked for yet                        |
| M5        | AI-151: Prove a cloud worker end to end and fix the runbook to match   | One ticket built by a cloud worker session                           | Waits on AI-150                                        |
| M10       | AI-266: M10.15: OpenRouter account, key and key limit                  | The paid gateway's key                                               | Parked: Andy uses his subscription                     |
| M10       | AI-267: M10.16: Claude API key and workspace spend limit               | The paid Claude key                                                  | Parked                                                 |
| M10       | AI-269: M10.18: First paid agent task under a cap                      | One paid task end to end under a test cap                            | Parked                                                 |

The paid path stays built and disabled. Outside any milestone: epic AI-154: Dependency agent (design PR #218, parked); AI-284: Require a PR to be up to date with main (parked, PR #300 closed); AI-139: Local-runner and executor git-isolation tests time out on the Mac; AI-211: MCP OAuth: revoke a stolen token's chains together; AI-259: M10.12: OpenCode executor via Actions (dropped from M10).

Parked milestones wait on their design PRs: M6 on PR #227, M7 on PR #221 and PR #249, M8 on PR #267, M9 on PR #268 and PR #265. Those and PR #218 are the only open PRs.

## 2. Decisions Andy made on 2026-11-23, and one still open

| Decision                                                                                                                                                   | Andy's answer | State                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| Require the checks `sandbox-self-test`, `agent-evals` and `agent-evals-plumbing`? They already run on every PR but are not required.                       | Yes           | AI-352: Baseline ruleset: three more required checks, in progress; Andy merges and applies the ruleset |
| Allow `mcp__ccd_pr__bind_pr` and `mcp__ccd_pr__set_monitor` without a prompt, so Auto-fix can always be turned on?                                         | Yes           | Allow rules added to Andy's user settings; not yet verified in a new session                           |
| Run the What's new backfill (runbook `whats-new-backfill.md`)?                                                                                             | Yes           | Run: wrote 158 notes, skipped 90 PRs that already had one; the page was not checked in a browser       |
| AI-347: count tickets, not questions, in every Needs-you count?                                                                                            | Yes           | AI-347 in progress                                                                                     |
| Which merge mode for project AI (ADR-0124: Merge modes)? `mergeMode` is unset, so the gate merges nothing without Andy; the suggested mode is `all-clean`. | Open          | Andy to choose: `manual`, `low-risk`, `all-clean` or `epic`                                            |

## 3. Questions for the review

The 2026-11-21 questions still apply (read model, dispatcher and gate replacing desktop coordinator sessions, word budgets, which parked milestone comes next). New since then:

- **Product discovery.** The brief (`platform/procedures/onboard.md`), the project plan (`plan-project.md`) and ideate (`ideate.md`) record and shape an idea Andy already has. Nothing helps him find or test one. Andy wants the system to help him ideate a good product, for himself and possibly to monetize. Missing: discovery before the brief (who has the problem, what exists), a challenge pass on the idea, monetization and effort against return, and "what should the next milestone be". Agent tasks have no web access, so research either runs in Andy's interactive Claude session and submits over MCP, or needs a new capped step.
- **Claude Ship against the built gate: keep, replace or mix?** Anthropic's hosted GitHub agents (Code Review, PR Steward, Claude Approvals) overlap the adversarial and security reviews, PR re-sync and the merge gate. They are for Team and Enterprise organizations and billed by usage, so not available on Andy's personal account today. The local `/ship` command can merge a PR when branch rules allow, which would bypass ADR-0120: who merges; check the rules before using it here.
- **First real use.** After the review Andy creates the first managed project (AI-111) and runs the first overnight trial (AI-129). What must be true before each?
