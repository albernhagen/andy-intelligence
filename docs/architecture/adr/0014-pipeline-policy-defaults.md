---
status: accepted
date: 2026-10-21
---

# 0014 — Pipeline and policy defaults (from ARCHITECTURE §4–§5)

Recorded so later changes have something to supersede.

## Decision Outcome

- Stages: Backlog → Ready → In progress → Ready for review → Monitoring → Done. Needs-you is a flag, not a stage.
- Definition of Ready requires EARS acceptance criteria, size with justification, declared dependencies, assigned tier, and **no open questions**. "Proceed on documented assumptions" is opt-in per project for S tasks only.
- Review gate is **rules only** in v1.x; M/L always go to Andy; the would-have-merged decision is recorded from M1.
- Model selection is by **tier** → ordered routes of (harness, provider, model); config narrows from global → project → epic → ticket and is compatibility-checked on save.
- Quota defaults: subscriptions reserve 20%, warn at 70%, pause dispatch at 80%; OpenRouter has hard USD caps. **Missing or stale quota = unknown**: warn, prefer the next route, never assume headroom.
- Every config change is a ConfigChange; agent/scout proposals are `pending` until Andy approves.
