# andy-intelligence — Spend and caps

How paid model spend is bounded (ADR-0129, proposed; M10: Paid models + spend caps, slices in [`m10-slices.md`](m10-slices.md)). Providers, tiers and routes: [`routing-and-policy.md`](routing-and-policy.md). GCP budgets: [`observability-and-cost.md`](observability-and-cost.md) §10.1.

**Terms.** A _paid_ route is one whose provider bills `pay_per_use` (OpenRouter, the `claude-api` provider); subscription routes (`claude-sub`, `google-sub`) are not paid. A _reservation_ is the worst-case cost held for a task before it starts. A _scope_ is global or one project; a _window_ is a UTC day or a UTC month.

## The ledger

One `SpendEntry` per paid agent task or direct call:

| State      | When                                        | Counts toward totals |
| ---------- | ------------------------------------------- | -------------------- |
| `reserved` | Before the task or call starts              | The reserved amount  |
| `settled`  | Its report arrives                          | The actual cost      |
| `released` | It never started (refused, cancelled first) | Nothing              |

- **Reserve amount:** a single call: input tokens × input price + max output tokens × output price. An agentic task: the per-task cap, which the harness enforces as its budget. Claude Code checks `--max-budget-usd` between turns, so it is a soft cap: one long turn can overshoot, and the provider limit is the hard stop (AI-260).
- **Settle amount:** the provider's reported cost when the report carries it, else usage × the model's prices. No usage: the full reservation. A cost over the reservation is recorded as reported and logged as a warning.
- **Open too long:** a reservation still open after its task's deadline settles at its full amount.
- **Atomic:** `reserve` checks totals plus the new amount against every cap and writes in one transaction, so concurrent starts can't overshoot (Firestore: one total document per scope and window).

## Caps

| Cap            | Scope            | Rule                                                     |
| -------------- | ---------------- | -------------------------------------------------------- |
| Per task       | One task or call | Its reservation can't exceed this                        |
| Daily, monthly | Global           | The ceiling                                              |
| Daily, monthly | Project          | Can only be lower than global; a higher value is ignored |

Caps are a `SpendCaps` setting (global document plus project fields); every change is a ConfigChange. A cap of 0 means no paid spend. Defaults (Andy, 2026-11-21): $5 a day, $50 a month global, $2 per task; projects default to the global caps.

## Fail closed

No paid call starts when any of these holds: the ledger can't be read or written; the model has no price; the caps can't be read; the reservation would pass any cap. Unknown is never treated as headroom (same rule as quota, `routing-and-policy.md`).

## Hard stop

- A refused reservation: the task doesn't start; dispatch records `spend_cap` as the project's last decision; route fallback (M10.14) may pick a non-paid route instead.
- Running tasks are not killed at a daily or monthly cap: their reservation already counted. They stop at their own per-task budget.
- Checked in `RunService.start` (every start, by hand too) and in the direct executor before each call.

## Two layers

| Layer          | Where                                                        | Who sets it                              |
| -------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Our caps       | Spend ledger, checked before each paid start                 | Andy, in settings or MCP                 |
| Provider limit | OpenRouter key credit limit; Anthropic workspace spend limit | Andy, by hand (runbook `paid-models.md`) |

The provider limit is at or below our monthly cap and holds if our ledger is wrong.

## What Andy sees

Spend today and this month against each cap (settings and Dashboards); a Needs-you notice at 80% of a cap and when a scope stops; every refusal logged as a warning with scope, cap and totals.

## Not covered

Subscription runs: their API-equivalent estimates (`cost.ts`) are shown, never capped. GCP spend: budgets and the kill switch (§10.1).
