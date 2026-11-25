# 2026-11-25 — Andy's decisions on the 29 proposed ADRs

Andy took every recommendation in [2026-11-23-proposed-adrs.md](2026-11-23-proposed-adrs.md). Only frontmatter `status` lines changed.

- **Accepted (27):** every ADR listed there except the two below.
- **Rejected (1):** ADR-0099: Agent read-only run token. Never built; a new credential gets a fresh ADR when agents need it. Its planned entry point is removed from the docs and its risk (R-AI-97) is closed.
- **Superseded (1):** ADR-0106: Context budgets: a PR uses at most half the room, by ADR-0138: Context budgets: a PR is judged on its own change.

## Tickets proposed by AI-364: Dispatcher and gate against a coordinator session

Andy also decided the eight tickets in [`spikes/AI-364.md`](../spikes/AI-364.md) §2:

- **Build now:** P3 → AI-382: Hold merges while main is red; P6 → AI-383: Break an approved milestone's epic into tickets for Andy's approval (plan first).
- **Later (Ideas):** P2 → AI-384: One ADR-number reservation for agents and sessions; P7 → AI-385: Handover in the digest.
- **Parked, no ticket:** P1, P4 (until the merge queue has merged real PRs), P5 (revisit after AI-381: setup wizard), P8 (watch).
