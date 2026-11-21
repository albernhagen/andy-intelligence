# Spend gate

An agent task on a paid (`pay_per_use`) route reserves its per-task cap in the spend ledger before it starts. It starts only if every cap holds: per task, project and global, daily and monthly. Its budget goes to the executor. A report settles the entry at the actual cost, or keeps the full reservation when usage is missing. A task that never got its instructions releases its reservation. Anything unknown stops the task: no price, unreadable caps or ledger, or a ledger error. Then dispatch reads `spend_cap`. Subscription routes reserve nothing. No model has a price yet, so no paid task starts.

**How to use:** nothing to do. A refused start shows "Dispatch: a paid agent task would pass a spend cap" on the project; logs carry `component: "spend-gate"`.
