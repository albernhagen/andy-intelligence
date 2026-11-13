---
status: proposed
date: 2026-11-12
amends: 0058 (ticket types: spike), 0050 (gate vetoes)
---

# 0102 — Spike tickets: a findings doc in a docs-only PR

AI-99: M5.23: Spike tickets. ADR-0058 left spikes for later, as "a written answer and proposed tickets, not a PR".

## Context and Problem Statement

Some tickets are questions, not changes: "can the board render 1,000 cards?", "which queue fits?". Today they get built as features, so the agent writes code to answer them. The answer should be a written record Andy can read, link and turn into tickets.

## Decision Outcome

- New ticket type `spike`. Ready when the body states the question, the acceptance criteria say what the findings must answer, and it has a size. **The size is the timebox**: it already sets the model and the run's turn cap.
- The build run writes its findings to `docs/spikes/<KEY>.md`: the answer, the evidence, the options with what each costs, a recommendation and proposed follow-up tickets. It changes nothing outside `docs/` (prompt line in `buildPrompt`; rule in `platform/procedures/build.md`).
- **It opens a docs-only PR**, unlike ADR-0058's note: a file in the repo is reviewable, survives the ticket and goes through the same checks.
- **New gate veto `spike_outside_docs`** (`decideGate`): a spike PR that changes any path outside `docs/`, under either name of a rename, can't auto-merge. The ticket is flagged and the comment lists the paths. The veto only adds a reason: it can never allow a merge another rule blocks (`docs/security/**` and ADRs stay protected paths).
- Refine knows the type: `refine.schema.json`, and in `refine.md` the criteria and the timebox.
- Not built: turning findings into tickets automatically (out of scope for AI-99).

### Consequences

- Good: questions get a cheap, read-only-in-effect answer with a durable record; an agent that drifts into code is stopped by a mechanical check, not the review agents alone.
- Bad: a spike that really needs a prototype must say so and be re-typed; findings in `docs/spikes/` grow without a pruning rule.
