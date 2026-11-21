# 2026-11-21 — Firestore reads: dispatch read the whole project on every event (AI-315)

- **What happened:** Andy's Firestore alert fired again: 22,541 document reads in an hour against 20,000. That was the day after AI-222 (PR #253, ADR-0126). About a dozen sessions were creating, editing and moving tickets, with about 20 open PRs.
- **Measured** with the AI-222 read counter against the real API at project AI's size (about 315 tickets, 100 archived, a 32-child epic):

  | Entry point                            | Reads             |
  | -------------------------------------- | ----------------- |
  | One dispatch event                     | 658               |
  | Project dashboard                      | 673               |
  | Digest                                 | 442               |
  | Epic `status` (32 children)            | 390               |
  | Board, ticket list right after a write | about 370 and 319 |
  | What's new, milestone map              | about 318         |

- **Cause:** dispatch. It runs after every move to Ready, answer, agent-task end, settings change and PR-webhook move. The build dispatcher listed every ticket (`archived: false` filters in memory, so archived ones were read too), the sync dispatcher listed them all again for the PR stages, and refine read the whole Backlog twice. About 35 events an hour at 658 reads is roughly 23,000.
- **Fix:** dispatch reads only its lanes by stage (Ready, In progress, Ready for review), each Ready ticket's epic by id, the night launch's stories by key, and Up next through a new `upNext` filter (a single-field query on `upNextRank`, no composite index). One dispatch is now 138 reads at that size, and it doesn't grow with Done, Cancelled or archived tickets; `apps/api/src/dispatch-reads.test.ts` checks this after a write.
- **Observability:** each request and each dispatch event now logs `request reads` or `dispatch reads` with its route, MCP tool and documents read (`apps/api/src/read-meter.ts`); `docs/runbooks/billing.md` says how to sum them. `READS_REPORT=1 pnpm vitest run apps/api/src/reads-report.test.ts` prints the table above.
- **Left for follow-ups:** the dashboard, digest, epic `status`, milestone map and What's new still read the whole project per call, and the board cache rarely holds while tickets change every minute.
