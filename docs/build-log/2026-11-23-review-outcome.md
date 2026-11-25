# 2026-11-23 — Product and architecture review: outcome

Andy's review of andy-intelligence, run in one session on 2026-11-23 from [the handover](2026-11-23-handover-review.md). This entry records what he decided. Terms: [glossary](../architecture/glossary.md).

## What the review found

- **The middle works, the ends don't.** Ticket → refine → plan → build → review → merge is built in the web UI and over MCP. Idea → brief is MCP only, and onboarding a second repo took three runbooks and seven hand steps.
- **The core path is unproven.** MCP `status` showed `lastDispatch: null` for project AI with 245 tickets Done: desktop coordinator sessions built this project, not the control plane's dispatcher. No managed repo and no night run had ever run.
- **Decisions lived outside the product.** `docs/build-log.md` held 18 pending decisions and 9 blockers while Needs-you showed one card. 33 of 124 ADRs were still proposed with their code merged.
- **Process weight, not code weight.** 16 required checks ran on a four-file docs PR; 187 files had word budgets and 20 were at or above 95% of their limit; 83 MCP tools were kept in step with the web UI by a test.
- **Nothing helped find or test an idea.** No step researched, challenged or scored one, and agent tasks have no web access.
- **Pickers hide their options.** Every picker is a native select; the merge-mode picker shows raw values and only the selected mode's description.

Not verified: check durations and quota used per PR; Firestore pricing; whether `lastDispatch: null` can also mean "no recent decision kept"; the availability and price of Anthropic's hosted review agents (Claude Ship).

## Decisions

| Topic                                      | Andy's decision                                                                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order of work                              | Fix gaps and finish M4 and M5 first, in one night through agents; then the first managed project                                                                                                                                                               |
| Open PRs                                   | All seven closed, branches kept (PR #218, #221, #227, #249, #265, #267, #268)                                                                                                                                                                                  |
| ADR-0096: Managed repos call one executor  | Accepted. Checked: agent tasks in different repos run in parallel; shared caps are 4 across projects and 1 at quota `warn`                                                                                                                                     |
| ADR-0124: Merge modes                      | Accepted                                                                                                                                                                                                                                                       |
| Up-to-date branches                        | Not required. AI-284 cancelled; the merge queue (AI-110) replaces it                                                                                                                                                                                           |
| Product discovery                          | A procedure run in Andy's own Claude session, submitted over MCP (AI-355); a case per milestone after it (AI-365). No agent step with web access                                                                                                               |
| Design                                     | A separate design session reviews every screen and shows mockups; Andy approves a direction before any ticket is built (epic AI-357)                                                                                                                           |
| Built gate and reviews against Claude Ship | Mix: keep the gate and both reviews; worker sessions rely on Auto-fix; `scripts/resync-prs.mjs` and `scripts/coordinator/` get no new features (AI-361)                                                                                                        |
| Dispatcher against desktop coordinators    | The first managed project runs on the dispatcher and gate only. The coordinator procedure and scripts stay: Andy also works hands-on in Claude Code. AI-364 compares the two and proposes tickets so the control plane matches what a coordinator session does |
| Word budgets                               | Hard limits only on files every agent loads; the rest warn (AI-362)                                                                                                                                                                                            |
| Read model                                 | ADR-0133: Board and ticket list read changed tickets accepted as built. Revisit past 10 projects or 2,000 tickets in one project                                                                                                                               |
| Over-built process                         | Light trim (AI-358, AI-359, AI-360). No code for parked milestones is deleted                                                                                                                                                                                  |
| Next parked milestone                      | M6: Dev → prod releases, after the first managed project works; prod-only path first, then AI-109: M5.16: Deploy scaffold for new projects                                                                                                                     |

## Approved work, in order

**Tonight, by a coordinator session with one worker per ticket:**

| Ticket                                                                        | Size, risk | Merge                         |
| ----------------------------------------------------------------------------- | ---------- | ----------------------------- |
| AI-354: Onboarding docs match the code before the first managed project       | S, low     | Merged (PR #387)              |
| AI-220: Merge modes: coordinator sessions merge through MCP `merge_pr`        | M, high    | Andy                          |
| AI-110: M5.18: Merge queue per repo                                           | M, high    | Andy                          |
| AI-216: Merge modes: epic PR mode                                             | M, high    | Andy                          |
| AI-217: Merge modes: GitHub enforces the kinds Andy keeps                     | S, high    | Andy, then a ruleset apply    |
| AI-355: Product discovery before the brief                                    | M, low     | Gate                          |
| AI-351: Parity: revoke a runner over MCP                                      | S, medium  | Gate                          |
| AI-356: Record Andy's decisions                                               | S, low     | Andy                          |
| AI-358: Docs-only PRs skip agent evals, UI screenshots, Firestore suite       | S, medium  | Andy                          |
| AI-362: Word budgets: hard limits only on files every agent loads             | S, medium  | Andy                          |
| AI-359: Narrower rules for ADRs and MCP parity                                | S, low     | Andy                          |
| AI-365: A case on every milestone before Andy approves it                     | M, low     | Gate                          |
| AI-360: Drop the shared contract suite for ports with one adapter             | S, low     | Gate                          |
| AI-361: Write down the reviewer seam                                          | S, low     | Gate                          |
| AI-364: The dispatcher and gate match what a coordinator session does (spike) | S, low     | Gate, after AI-220 and AI-110 |

**Andy's own:**

| Ticket                                     | What must be true first                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-111: M5.4: First managed project live   | The four merge tickets merged and main green; a public pnpm repo; `runsAtOnce` 2 on each project; merge mode `low-risk`; no deploy. Runbook: `docs/runbooks/managed-project.md` |
| AI-129: M4.23: First overnight run trial   | Five tickets merged cleanly in the managed project; one small epic with every ticket in Ready and its plan approved; caps far under the maximum                                 |
| AI-150, then AI-151: cloud worker sessions | Ten minutes in Andy's Claude and GitHub accounts; not needed for the first project                                                                                              |

**After mockups are approved:** epic AI-357: Design and UX: a best-in-class UI across the whole system, including a brief form, pickers that show every option with its description, and AI-353: UI PRs show before and after screenshots.

## Kept, cut, deferred

- **Kept:** the merge gate and merge modes; the adversarial and security reviews and their evals; Auto-fix on worker PRs; the executor called at `@main`; the ticket snapshot read model.
- **Cut:** AI-284: Require a PR to be up to date with main; AI-363: Simplify the read model (created, then cancelled the same evening); replacing the reviews with a hosted reviewer until one works on a personal account.
- **Deferred:** M7: Mobile, M8: Project members, M9: Add Jules + model routing; the three M10 key tickets (AI-266, AI-267, AI-269); epic AI-154: Dependency agent.

## Open risks

- **SHA pinning against `@main`.** The baseline requires actions pinned to a commit SHA in a managed repo, and its `agent-run.yml` calls the executor at `@main`. Untested; the first refine in the new repo will show it.
- **Four merge-path changes land the night before first use.** Hence `low-risk` mode for the first managed project.
- **ADRs cited but not on main.** ADR-0114, ADR-0115 and ADR-0127 exist only on closed branches (`m6.1/releases-design`, `docs/slice-m7-mobile`, `m8.1/members-design`). Each is fixed when its milestone is unparked.
- **Desktop sessions need the Mac awake.** It slept three times in an hour during this work.
