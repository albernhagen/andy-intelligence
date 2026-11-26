---
title: Merge modes: one project setting decides who merges
status: accepted (Andy, 2026-11-23); amended by 0134, 0144 (GitHub does not require up-to-date branches), 0157 (proposed: Andy's Merge in the web app waives what the mode keeps for him); GitHub does not enforce its code-owner rule on this repo (AI-380, R23)
date: 2026-11-20
amends: 0050 (`autoMerge`), 0078, 0088, 0092, 0120 (who merges), 0107 (night runs)
---

# 0124 — Merge modes: one project setting that the gate and coordinator sessions both apply

AI-213: Merge modes: design and ADR, under AI-212: Merge modes: a project setting for how and when PRs merge. Andy, 2026-11-20: "it's really almost a mode … how/when to merge/group PRs (merge all, merge only low risk, require building to single epic PRs, etc.)". Andy's questions are on AI-213; this ADR is written with the recommended answers.

## Context and Problem Statement

Three rules decide who merges, and they disagree: the gate merges agent PRs by the project's `autoMerge` size policy (`none` / `s` / `s-and-m` / `all`, ADR-0050) after its own protected-path vetoes (ADR-0078's list); coordinator sessions merge by hand-applied risk lists (ADR-0088, ADR-0092, ADR-0120: every clean PR except four kinds); night runs merge stories into an epic branch (ADR-0107). Andy changes the rule by telling a session, and each change is a new ADR. The coordinator's rule is applied by reading untrusted text, with Andy's own GitHub token (threat model R23).

## Decision Outcome

| Topic             | Decision                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The setting       | `mergeMode` per project replaces `autoMerge`. **Clean** means: every check passed on the head, both review agents posted a verdict there with no open blocker, should-fix, high or critical finding, the head contains the latest default branch, no `review-accepted` / `security-accepted` label.                                                                                          |
| `manual`          | Nothing merges into the default branch without Andy.                                                                                                                                                                                                                                                                                                                                         |
| `low-risk`        | A clean PR merges when nothing in its diff is on the high-risk list (ADR-0092's table, held as one path list in `packages/domain`). The rest queue for Andy.                                                                                                                                                                                                                                 |
| `all-clean`       | A clean PR merges unless it is a **kept kind** (below). ADR-0120's rule as a setting.                                                                                                                                                                                                                                                                                                        |
| `epic`            | A story of an epic merges into `epic/<KEY>` when clean (ADR-0107's mechanics); Andy merges one PR per epic. A ticket with no epic queues for Andy. Night runs group this way in every mode.                                                                                                                                                                                                  |
| Kept kinds        | In every mode Andy merges: who merges (this ADR's rule, `coordinate.md`, runbook `coordinating-sessions.md`, `AGENTS.md` rule 2); what judges a PR (`.github/**`, `platform/actions/**`, `platform/baseline/**`, `CODEOWNERS`, review scripts, procedures and evals); PRs that need his hands (Terraform apply, a secret, an external account, an App permission); an open finding or doubt. |
| Who applies it    | One function, `mergeVerdict(facts, mode)` in `packages/domain`, from GitHub facts, never PR text. The gate calls it for agent PRs. Coordinator sessions stop merging with Andy's token: they call MCP `merge_pr`, which runs the same verdict and merges with the App token, squash, pinned to the assessed head, one at a time.                                                             |
| GitHub enforces   | `CODEOWNERS` lists only the kept paths, and `protect-main` requires a code owner's approval and up-to-date branches. The App is not a bypass actor; Andy merges kept-kind PRs with his admin bypass. "Needs his hands" and "doubt" stay procedural.                                                                                                                                          |
| Overrides         | An epic or ticket may set a stricter mode (`overrides.mergeMode`), never a looser one.                                                                                                                                                                                                                                                                                                       |
| Changing the mode | Owner only, in project settings; MCP `set_merge_mode` may tighten only. Every change goes in the config change log (AI-118). An agent may propose a change as a pending `ConfigChange`, never apply it.                                                                                                                                                                                      |
| Mapping           | `autoMerge` `none` → `manual`; `s`, `s-and-m` → `low-risk`; `all` → `all-clean`. Project AI is the exception: it becomes `all-clean`, the rule its coordinator applies today (ADR-0120), not `manual`. Size no longer decides (ADR-0120). New projects default to `low-risk`.                                                                                                                |
| Record            | Each merge without Andy stores the mode and verdict on the PR record; What's new (AI-159) shows it.                                                                                                                                                                                                                                                                                          |

ADR-0078, ADR-0088, ADR-0092 and ADR-0120 stop deciding who merges once `merge_pr` ships (AI-215); until then ADR-0120 stands. ADR-0092's table becomes the `low-risk` path list.

**Slices** (AI-212): AI-214 setting → AI-215 verdict and gate → AI-220 `merge_pr` → AI-217 GitHub enforcement; AI-216 epic mode and AI-218 queue and What's new after AI-215.

### Consequences

- Good: Andy changes one setting instead of writing an ADR; the gate and sessions cannot disagree; R23's hand-applied lists become code, and the kept paths a GitHub rule the App cannot pass.
- Bad: sessions still hold Andy's GitHub token and could merge directly; that stays procedural (R23) until sessions get a token without merge rights. Requiring code-owner approval on kept paths means Andy clicks bypass on each of them, as he merges them today.
