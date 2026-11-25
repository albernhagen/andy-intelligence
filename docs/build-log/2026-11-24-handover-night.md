# 2026-11-24 — Handover: the night of 2026-11-23 (coordinator)

For a fresh session with no chat history. One coordinator session ran worker sessions from 21:15 MST on 2026-11-23 on Andy's order: finish the approved work, then build epic AI-357: Design and UX. Facts come from `gh pr list`, `scripts/coordinator/survey.mjs` and MCP `status`, read at 01:15 MST on 2026-11-24, sections 1 to 3 again at 22:10 MST. Terms: [glossary](../architecture/glossary.md).

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

The first eight merged before Andy went to bed; the last five during 2026-11-24 (main `225af6b7` at 22:10 MST). Still to do by hand: apply the ruleset for AI-217 (runbook `onboard-a-repo.md` §1b), and decide the proposed ADRs in `2026-11-23-proposed-adrs.md`.

## 2. Waiting for Andy's merge

No session merged anything during the night: a worker's MCP `merge_pr` call was refused by the auto-mode permission check on Andy's machine, and the procedure allows no other way.

| PR   | Ticket                                                                            | State at 22:10 MST                  | After the merge                                        |
| ---- | --------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| #404 | AI-364: The dispatcher and gate match what a coordinator session does (docs only) | Clean                               | Approve or drop its eight proposed tickets (P1 to P8). |
| #402 | AI-366: Screenshot coverage                                                       | Main merged in; one check running   | Then retarget #409 to `main`. Also inside #419.        |
| #409 | AI-353: UI PRs show before and after screenshots                                  | Stacked on #402; one review finding | Nothing to apply.                                      |

## 3. Epic AI-357: Design and UX

Built as stacked PRs, one per ticket, each reviewed: #402 (AI-366), #406 (AI-367), #408 (AI-368), #407 (AI-369), #410 (AI-370), #411 to #418 (AI-371 to AI-378). Most carry one adversarial blocker, "Stacked PR", which no code clears.

**PR #419 (AI-379: Phone pass) is the epic PR.** Its branch `m11/ai-379-phone-pass` holds every ticket above merged together, plus the phone pass; its base is `main`. At 22:10 MST on 2026-11-24 its checks and both reviews were clean on head `215b17c`, but it conflicted with `main` (2 commits behind) and its worker was merging `main` in: not verified clean. Merging #419 lands the epic except AI-353. Then close #402, #406 to #408 and #410 to #418 and move their tickets to Done by hand (a PR event moves only AI-379).

Known gaps: AI-374 and AI-375 both regenerated six ticket-panel images (resolved only on the epic branch); screens AI-371 to AI-376 built their own page headers, while `PageHeader.tsx` (AI-378) is the shared one.

## 4. What got in the way

| Problem                                                                                  | Effect                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The desktop app starts sessions only on turns Andy begins                                | Later tickets went to idle or unarchived workers by message |
| Workers are archived when their PR merges; worktree folders are reused                   | One worker was told to make its own worktree                |
| A long-lived coordinator has no MCP tool deployed after it started (`merge_pr`)          | The coordinator could not call it                           |
| A re-sync merge leaves both review checks "not reviewed" until another push (seen twice) | One extra push per affected PR                              |

ADR numbers handed out: 0143 to 0153 (0146 and 0152 only if needed). Next free: 0154.
