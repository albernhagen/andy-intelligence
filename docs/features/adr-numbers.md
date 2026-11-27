# ADR numbers for sessions and agent tasks

One sequence of ADR numbers per project, shared by build runs and Claude sessions (AI-384, ADR-0080, ADR-0166). Before, build runs reserved numbers in the control plane while a coordinator handed numbers to worker sessions by hand, and parallel PRs clashed.

**How it works:** MCP `reserve_adr_number` with a ticket key returns the next number above the highest `docs/architecture/adr/NNNN-*.md` on the default branch and above every number handed out before, to a build run or a session. A build run's reservation skips every number a session holds. A number is never handed out twice, so one never used is a gap, like 0161.

| Rule            | Value                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| Holder          | The ticket key passed to the tool                                                          |
| Caps (ADR-0028) | 5 open per ticket, 20 per project; at a cap the call is refused with the open holds listed |
| Released        | When the ticket's PR into the default branch merges or closes, or after 7 days             |
| Who             | Andy's MCP grant only (owner only); MCP only, sessions write ADRs and the web does not     |

**How to use:** a worker calls `reserve_adr_number` with its ticket key; runbook [`coordinating-sessions.md`](../runbooks/coordinating-sessions.md) §3.
