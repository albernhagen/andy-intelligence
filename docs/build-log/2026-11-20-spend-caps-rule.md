# 2026-11-20 — AI-235: M10.3: Spend caps rule

Pure rule for M10: Paid models + spend caps: may this paid call go ahead? Nothing stores caps or calls the rule yet (M10.8, M10.7).

- `packages/contracts/src/entities/spend-caps.ts`: `SpendCaps` (global `dailyMicroUsd`, `monthlyMicroUsd`, `perTaskMicroUsd`), `ProjectSpendCaps` (each optional), `EffectiveSpendCaps`, `SpendSoFar`, and `DEFAULT_SPEND_CAPS` ($5 a day, $50 a month, $2 per task, M10.1's recommended answer to question 1). Integer micro-dollars only.
- `packages/domain/src/spend-caps.ts`:
  - `effectiveCaps(global, project)`: a project value counts only when lower than the global one (global is the ceiling); a missing one is the global value.
  - `maySpend(caps, totals, estimate)`: `allow`, or the first cap passed (`per_task`, `project_daily`, `project_monthly`, `global_daily`, `global_monthly`), or `unknown`. It fails closed: unknown or unparsable totals, no price, a fraction, a negative, or a missing or malformed cap is `unknown`, never `allow`.
- Same cap names and the same "used + estimate > limit" test as the ledger's `spendCapPassed` (AI-234: M10.2, PR #274, not on `main` when this was built). This file defines its own local integer schema instead of importing AI-234's `MicroUsd`, and exports no name that PR also exports.
- 22 tests.
