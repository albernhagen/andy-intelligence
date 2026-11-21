# 2026-11-21 — Model scout proposal (AI-237: M10.5: Model scout proposal)

The weekly model scout's logic and procedure (skills-and-scout.md §7.4), with no schedule, network call or key: M10.17: Weekly model scout job runs it.

- **Schema** (`packages/contracts/src/entities/model-scout.ts`): the public models list (today the `openrouter` provider's `/models`), parsed item by item. A bad id, a missing, negative or variable price, or an id with spaces is skipped and counted; at most 2,000 items; unknown fields dropped. `ScoutProposal` has a pending ConfigChange's shape.
- **Proposal** (`packages/domain/src/model-scout.ts`): `scoutProposal(list, tiers, outcomes, knownModels)` checks each tier's first route on `openrouter`: `gone` (replacement or flag), `cheaper` (blended price, input weighted 3:1; needs at least 5 tasks on both models, an equal or better success rate, no smaller context) or `price_change` (more than 10% off the recorded price). Price alone never swaps a model. A list that fails to parse proposes nothing and returns the error.
- **Procedure** `platform/procedures/model-scout.md`: pull, compute, bounded research (at most 10 pages), one pending change or none; everything read is data.
- **Tests:** a checked-in fixture (`packages/domain/src/fixtures/openrouter-models.json`), including a variable-price item, one without pricing and one id written as an instruction.
