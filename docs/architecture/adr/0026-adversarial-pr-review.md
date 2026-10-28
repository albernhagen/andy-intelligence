---
status: accepted
date: 2026-10-27
amends: 0025
---

# 0026 — Adversarial PR review

## Context and Problem Statement

A reviewer that summarizes or approves a diff adds little. Agents write most of the code, and the same model that wrote a change tends to accept its own assumptions. Andy wants reviews that actively try to break each PR.

## Decision Outcome

Every PR gets an **adversarial review agent** alongside the security reviewer (ADR-0025):

- **Brief:** find reasons this PR should not merge — wrong behavior, unhandled edge cases, missing or weak tests, contract or ADR violations, unnecessary complexity, docs that no longer match the code.
- **Evidence required:** each finding names a concrete failing scenario (input → wrong result) or the rule it breaks. No style nits; linters own style.
- **Severity:** `blocker`, `should-fix`, `question`.
- **Independence:** a fresh session with no builder context and read-only tools (no shell, no network). From M2: Add Jules + model routing / M3: Paid models + spend caps, a different vendor than the implementer.
- **Response loop:** the implementer replies to every finding (fixed in commit X, or why not). Unresolved `blocker` findings fail the `adversarial-review` check; Andy can override with the `review-accepted` label and a reason.
- **Guardrails** as in ADR-0025: same-repo PRs only, `contents: read` + `pull-requests: write`, PR content is untrusted. If the agent can't run, its check is neutral.
- Shares workflow plumbing with the security reviewer; one reviewer prompt per role in `platform/procedures/`.

Lands in this repo in slice M1.11: Adversarial PR review; in managed projects from M4: Second project + epics + story board. Replaces the plain "cross-model review comments" in ARCHITECTURE §4.5.

### Consequences

- Good: catches defects before merge; forces the implementer to defend choices; produces a record of findings and outcomes for later gate tuning.
- Bad: more quota per PR push; false positives cost review time (mitigated by evidence requirement and override label).
