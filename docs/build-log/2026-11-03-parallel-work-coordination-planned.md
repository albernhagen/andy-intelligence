# 2026-11-03 — Parallel-work coordination planned

- **Decided (Andy, ADR-0047: Coordinating parallel work):** no LLM parent agent; the control plane stays the supervisor. andy-intelligence builds itself in 3 phases: track slices as tickets now, S tickets after M1: First end-to-end flow, most work after M2: Multi-project in parallel. M2: Multi-project in parallel adds conflict-aware dispatch, sync runs, a merge queue, collision-free IDs, an in-flight view and cross-project dependencies (from today's hand-resolved conflicts).
