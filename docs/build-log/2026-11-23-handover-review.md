# 2026-11-23 — Handover for Andy's product and architecture review (update)

For a fresh session with no chat history. It replaces the state in [2026-11-21-handover-review.md](2026-11-21-handover-review.md); that file's "What went wrong" table still stands. Facts come from MCP `roadmap` and `status`, `git log origin/main` and `gh pr list`, read at 16:30 MST on 2026-11-23. Terms: [glossary](../architecture/glossary.md).

## 1. Where the build stands

The build is finished for now. Andy's order (2026-11-23): finish the build, do the product and architecture review in a new session, then try the system by creating the first managed project.

**Main** is at `40433e41` (AI-205: M4.27: One glossary; retire the slice tables and the words slice and story, PR #383). Its CI runs were still in progress when this was written: not verified green. No worker session is running.

Project AI now has eleven milestones (ADR-0131: Milestones), each with its epics attached:

| Milestone                                 | Status   | Done     | Open tickets, and why                                                                                                                                                                                                                                                             |
| ----------------------------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0: Foundations: repo, sign-in, GCP infra | approved | no epic  | None                                                                                                                                                                                                                                                                              |
| M1 to M3                                  | approved | 38 of 38 | None                                                                                                                                                                                                                                                                              |
| M4: Epics + ticket board                  | approved | 77 of 80 | AI-129: M4.23: First overnight run trial (after the review); AI-347: Needs you counts the same unit everywhere (Andy to decide); AI-351: revoke a runner over MCP (held)                                                                                                          |
| M5: Multi-project in parallel             | approved | 38 of 46 | AI-111: M5.4: First managed project live (after the review); AI-216, AI-217, AI-220 (merge modes) and AI-110: M5.18: Merge queue per repo (deferred to the review); AI-109: M5.16: Deploy scaffold (waits on parked M6); AI-284: Require a PR to be up to date with main (parked) |
| M10: Paid models + spend caps             | approved | 16 of 19 | AI-266, AI-267, AI-269: keys and the first paid task. Parked: Andy uses his subscription; the paid path stays built and disabled                                                                                                                                                  |
| M6: Dev → prod releases                   | parked   | 5 of 20  | Design PR #227                                                                                                                                                                                                                                                                    |
| M7: Mobile                                | parked   | 9 of 18  | PR #221, PR #249                                                                                                                                                                                                                                                                  |
| M8: Project members                       | parked   | 2 of 15  | Design PR #267                                                                                                                                                                                                                                                                    |
| M9: Add Jules + model routing             | parked   | 9 of 16  | PR #268, PR #265                                                                                                                                                                                                                                                                  |

Epic AI-154: Dependency agent has no milestone; its design PR #218 is parked. The seven PRs named above are the only open PRs.

## 2. Open decisions for Andy

| Question                                                                          | Recommended                                     |
| --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Require the checks `sandbox-self-test`, `agent-evals` and `agent-evals-plumbing`? | Decide in the review                            |
| Permission rules for `mcp__ccd_pr__bind_pr` and `mcp__ccd_pr__set_monitor`?       | Allow both, so Auto-fix can always be turned on |
| Which merge mode for project AI (ADR-0124: Merge modes)?                          | Decide in the review                            |
| Run the What's new backfill (runbook `whats-new-backfill.md`)?                    | Yes, once                                       |
| AI-347: count tickets, not questions, in every Needs-you count?                   | Yes                                             |

## 3. Questions for the review

The 2026-11-21 questions still apply (read model, dispatcher and gate replacing desktop coordinator sessions, word budgets, which parked milestone comes next). New since then:

- **Product discovery.** The brief (`platform/procedures/onboard.md`), the project plan (`plan-project.md`) and ideate (`ideate.md`) record and shape an idea Andy already has. Nothing helps him find or test one. Andy wants the system to help him ideate a good product, for himself and possibly to monetize. Missing: discovery before the brief (who has the problem, what exists), a challenge pass on the idea, monetization and effort against return, and "what should the next milestone be". Agent tasks have no web access, so research either runs in Andy's interactive Claude session and submits over MCP, or needs a new capped step.
- **Claude Ship against the built gate: keep, replace or mix?** Anthropic's hosted GitHub agents (Code Review, PR Steward, Claude Approvals) overlap the adversarial and security reviews, PR re-sync and the merge gate. They are for Team and Enterprise organizations and billed by usage, so not available on Andy's personal account today. The local `/ship` command can merge a PR when branch rules allow, which would bypass ADR-0120: who merges; check the rules before using it here.
- **First real use.** After the review Andy creates the first managed project (AI-111) and runs the first overnight trial (AI-129). What must be true before each?
