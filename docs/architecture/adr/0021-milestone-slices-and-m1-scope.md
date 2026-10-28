---
status: accepted
date: 2026-10-22
---

# 0021 — Milestones built as slices; M1 scope cuts

## Context and Problem Statement

M1 as written bundled the board with drag-and-drop, the GitHub App, the watchdog, refinement, the inbox, remote MCP with OAuth, quota capture, backups and the executor — too much for one PR or one agent session, with an unresolved OAuth spike in the middle.

## Decision Outcome

- Each milestone is delivered as **slices** (ARCHITECTURE §12): one PR each, own "Done when", sized for one agent session, with declared dependencies so independent slices can run in parallel. L slices are split before starting. `docs/build-log.md` tracks slice status.
- **No stacked PRs.** A slice branches from the latest `main` only after its dependencies have merged.
- M1 is sliced M1.0–M1.9 in ARCHITECTURE §12. The MCP OAuth spike (M1.1) runs early to retire the largest unknown.
- Cut from M1 to M4: drag-and-drop board (M1 ships a list view grouped by stage), dedicated run-detail screen, agent read access to API/MCP. Quota capture (M1.9) is timeboxed and best-effort; readings stay "unknown" if `rate_limits` isn't capturable headless.
- M2–M5 slice tables are proposed by the builder at milestone start and approved by Andy.

### Consequences

- Good: reviewable PRs; parallel sessions; early failure on the riskiest piece.
- Bad: more PRs to merge; a slice waits for its dependencies to merge before starting.
