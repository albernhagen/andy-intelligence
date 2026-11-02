---
status: accepted
date: 2026-11-01
---

# 0037 — Review agents share composite actions; adversarial re-reviews are incremental

Decided by Andy, 2026-11-01 (M1.11: Adversarial PR review).

## Context and Problem Statement

ADR-0026 asks for an adversarial reviewer that "shares workflow plumbing with the security reviewer", fails on unresolved blockers, and clears them once the implementer fixes or answers. Three constraints showed up:

- A reusable workflow (`workflow_call`) renames its check to `<caller> / <job>`. The `protect-main` ruleset requires a check named exactly `security-review`, so moving it into a reusable workflow would block every merge until the ruleset changed.
- GitHub has no workflow trigger for "review thread resolved", so a check can't follow thread resolution.
- Andy's subscription quota is shared with all his other Claude use, and many PRs mean many pushes.

## Decision Outcome

| Question           | Decision                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared plumbing    | Two **composite actions**: `.github/actions/agent-review-prepare` (mode, label removal, docs-only skip, inputs in `.review/`) and `agent-review-finish` (gate, sticky comment, fail). The agent step stays in each workflow, so its `timeout-minutes` and `continue-on-error` keep a failed agent neutral. Check names are unchanged. M1.16: Project baseline v1 can pin these actions by SHA. |
| Gate               | `scripts/review-gate.mjs` with one config per role (severities, blocking set, label, marker). Replaces `security-review-gate.mjs`; `review-scope.mjs` replaces `security-review-scope.mjs`.                                                                                                                                                                                                    |
| Clearing a blocker | **Stateless re-review.** Every run gets its previous comment and the discussion (PR body and comments by `OWNER`/`MEMBER`/`COLLABORATOR` only; capped at 50 KB; untrusted). A blocker stays open until a commit fixes it; replies are context only (they can settle a `question` or `should-fix`), because the implementing agent posts under Andy's account. Disagreement: `review-accepted`. |
| Quota              | Adversarial: Sonnet, max 40 turns, docs-only PRs skipped, and **incremental** on later pushes: the agent reviews the commits since the SHA recorded in its last comment, plus the open findings. A force-push falls back to a full review. Security review stays full on every push (cheap, and a later push can combine into a new issue).                                                    |
| Override           | `review-accepted` label, removed on every push (same as `security-accepted`).                                                                                                                                                                                                                                                                                                                  |
| Usage line         | Says "uses subscription quota, not billed": the dollar figure is an API-equivalent estimate.                                                                                                                                                                                                                                                                                                   |

### Consequences

- Good: one place to fix review plumbing; the ruleset is untouched; later pushes cost a fraction of a full review.
- Bad: replies are a new prompt-injection channel, limited to the owner and collaborators, and can't clear blockers; an incremental review can miss an interaction between new and old code that only a full review would see (the security review still reviews everything); composite actions run from the PR's own checkout, like workflows (threat-model risk R5).
