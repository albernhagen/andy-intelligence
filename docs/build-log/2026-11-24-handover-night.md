# 2026-11-24 — Handover: the night of 2026-11-23 (coordinator)

For a fresh session with no chat history. One coordinator session ran worker sessions from 21:15 MST on 2026-11-23 on Andy's order: finish the approved work, then build epic AI-357: Design and UX. Facts come from `gh pr list`, `scripts/coordinator/survey.mjs` and MCP `status`, read at 01:15 MST on 2026-11-24, sections 1 to 3 again at 22:20 MST. Terms: [glossary](../architecture/glossary.md).

## 1. Merged (by Andy)

| Ticket                                                               | PR   |
| -------------------------------------------------------------------- | ---- |
| AI-356: Record Andy's decisions                                      | #388 |
| AI-351: Parity: revoke a runner over MCP                             | #389 |
| AI-355: Product discovery before the brief                           | #390 |
| AI-360: Drop the shared contract suite for ports with one adapter    | #393 |
| AI-362: Word budgets: hard limits only on files every agent loads    | #394 |
| AI-220: Merge modes: coordinator sessions merge through MCP merge_pr | #392 |
| AI-361: Write down the reviewer seam                                 | #396 |
| AI-365: A case on every milestone before Andy approves it            | #397 |
| AI-110: M5.18: Merge queue per repo                                  | #403 |
| AI-216: Merge modes: epic PR mode                                    | #405 |
| AI-217: Merge modes: GitHub enforces the kinds Andy keeps            | #400 |
| AI-358: Docs-only PRs skip agent evals, UI screenshots and Firestore | #399 |
| AI-359: Narrower rules                                               | #401 |
| AI-364: The dispatcher and gate match a coordinator session (docs)   | #404 |
| Epic AI-357: Design and UX, AI-366 to AI-379 (the epic PR)           | #419 |

The first eight merged before Andy went to bed; the rest during 2026-11-24 (main `9094142b` at 22:20 MST). Still to do by hand: apply the ruleset for AI-217 (runbook `onboard-a-repo.md` §1b), decide the proposed ADRs in `2026-11-23-proposed-adrs.md`, and approve or drop AI-364's eight proposed tickets (P1 to P8).

## 2. Waiting for Andy's merge

No session merged anything during the night: a worker's MCP `merge_pr` call was refused by the auto-mode permission check on Andy's machine, and the procedure allows no other way.

One PR is left, **#409 (AI-353: UI PRs show before and after screenshots)**, a kind Andy keeps. Its base is now `main`; at 23:00 MST every check was green and both reviews were clean on head `8049a1b`. Nothing to apply after the merge.

## 3. Epic AI-357: Design and UX

Landed on `main` as one squash commit, PR #419 (AI-379: Phone pass), which held AI-366 to AI-379 except AI-353. The coordinator moved AI-366 to AI-378 to Done by hand (the PR event moved only AI-379).

Closed without merging on Andy's word, since their work is on `main`: #402, #407, #408 and #410 to #418.

**Not on `main`:** commit `b543c62a` (AI-367: Dashboard screenshots wait for the bundled fonts before the charts draw, one file, `apps/web/e2e/dashboard-fixtures.ts`). It was pushed to #406 a minute before #419 merged, and #406 was merged into #402's branch, not `main`. Without it the dashboard screenshot check can fail at random. It landed as PR #422, which Andy merged; #402 is closed.

Added on the epic branch after a merge of `main`: MCP read tool `brief_status`, so AI-373's `GET /api/projects/{id}/brief` passes ADR-0148's parity rule.

Known gap: screens AI-371 to AI-376 built their own page headers, while `PageHeader.tsx` (AI-378) is the shared one.

## 4. What got in the way

| Problem                                                                                  | Effect                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The desktop app starts sessions only on turns Andy begins                                | Later tickets went to idle or unarchived workers by message |
| Workers are archived when their PR merges; worktree folders are reused                   | One worker was told to make its own worktree                |
| A long-lived coordinator has no MCP tool deployed after it started (`merge_pr`)          | The coordinator could not call it                           |
| A re-sync merge leaves both review checks "not reviewed" until another push (seen twice) | One extra push per affected PR                              |

ADR numbers handed out: 0143 to 0153 (0146 and 0152 only if needed). Next free: 0154.
