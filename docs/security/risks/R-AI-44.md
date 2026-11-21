---
id: R-AI-44
severity: medium
status: open
owner: Andy
---

# R-AI-44

**Risk:** Stolen runner secret spends quota; an injected local agent reads the Mac.

**Mitigation / next step:** Seatbelt (agent, platform, install, publish); the agent's network is HTTPS and DNS only; one runner per home, lock taken atomically. Residual: ADR-0098, ADR-0101, ADR-0122, `local-executor.md`.
