---
title: Paid spend reserved in a ledger against caps that fail closed
status: proposed
date: 2026-11-20
amends: 0028 (caps on what spends), 0050 (capped API-key provider)
---

# 0129 — Paid model spend is reserved in a ledger before it happens, against caps that fail closed

AI-227: M10.1: Spend design, for M10: Paid models + spend caps. ADR-0028 says anything that can spend needs an explicit cap; until M10 every agent task runs on the flat-rate Claude subscription, so nothing spends per call.

## Context and Problem Statement

M10 adds three ways to spend money per call: OpenCode and direct calls through OpenRouter, and Claude Code on an API key. Andy wants building to continue overnight, unattended. A cost known only after a task ends can't stop the task that passes the cap, and a provider's bill arrives hours later. `Provider.dailyCapUsd` and `monthlyCapUsd` exist in contracts but nothing reads them.

## Decision Outcome

- **Reserve, then settle.** Before any paid agent task or call starts, the control plane reserves its worst-case cost in a spend ledger (`SpendLedger` port). When it ends, the entry settles to the actual cost, or is released if it never started. Totals per scope and window count settled plus open reservations.
- **Caps:** global daily, global monthly, per-task; per-project daily and monthly that can only lower the global ones. A reservation that would pass any of them is refused, atomically, so concurrent starts can't overshoot.
- **Fail closed:** an unreadable ledger, a model with no price, or a cap setting that can't be read refuses the reservation. A task whose usage is unknown settles at its full reservation. A reservation still open after its task's deadline settles at its full amount; it is never silently released.
- **Hard stop:** a refused reservation means the task doesn't start and dispatch idles with `spend_cap`. Tasks already running stay within their own reservation, enforced by the harness's per-task budget.
- **Second layer:** each paid provider gets its own limit at or below our monthly cap (OpenRouter key credit limit, Anthropic workspace spend limit), set by Andy. It holds if our ledger is wrong.
- **Scope:** only `pay_per_use` routes reserve. Subscription runs keep their API-equivalent estimates (`cost.ts`) and never count against caps.
- **Caps live in a `SpendCaps` setting** owned by M10, not on `Provider`; each change is a ConfigChange.

Default cap values are Andy's decision (question on AI-227); the code ships with whatever he picks, and with paid providers disabled.

### Consequences

- Good: no paid call starts unless its worst case fits; Andy sees why work waits; two independent caps.
- Bad: worst-case reservations block work earlier than actual spend would; a long agentic task ties up its whole per-task budget until it settles.
- Bad: settling depends on the run report; a lost report counts the full reservation, which can idle paid work until the next window.
