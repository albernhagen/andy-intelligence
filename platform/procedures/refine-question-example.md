# Refine: a question, bad and good

Moved out of [`refine.md`](refine.md) (its "Questions Andy can answer" section has the rules) to keep that procedure within its word budget. Not part of the refine prompt.

Bad: `AI-6: M1.17: Agent evals v1, q1: who pays for model calls in CI.`

Good: "Should the agent evals CI job (AI-6: Agent evals v1) pay for model calls from Andy's Claude subscription or an API key?" Context: "Agent evals replay fixed tickets through each agent to catch regressions. Nothing runs them today. The workflow needs a payer before it can land." Options: Subscription (no new spend; uses the weekly quota), API key (about $2 a run; a new secret). Recommendation: Subscription, no new secret or bill.
