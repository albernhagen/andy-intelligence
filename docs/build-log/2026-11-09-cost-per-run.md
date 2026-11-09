# 2026-11-09: Cost per run, totalled per ticket

AI-67: Cost per run, totalled per ticket.

- The executor report now sends `usage` from Claude Code's result; nothing about how the executor runs changed.
- `Run` gained optional `usage` and `quotaDelta`. `costUsd` on a subscription run is now the rate-table estimate; with no usage it is null (unknown), even if the report carried a figure.
- Quota delta uses the stored reading just before the report rather than a reading at dispatch, so no dispatch change was needed. `Run.quotaSnapshot` stays unused.
- The ticket total is one domain function (`ticketCost`) used by the API, MCP `status` and the web line.
- Rates: API list prices as of 2026-10-06. Haiku 5.5 cache prices are derived (0.1× and 1.25× input). Cache writes are at the 5-minute price; Haiku's above-100K-token price is not modelled.
- Unknown runs: a missing or malformed `usage` leaves the cost unknown and still records the report. A model not in the table falls back to the harness's own figure. Pay-per-use keeps the reported amount.
- Quota delta is null for a window that reset between readings or has no earlier reading. It is approximate: runs in other projects at the same time can blur which run used what, and two reports that overlap can read the same earlier reading and count the same usage twice.
