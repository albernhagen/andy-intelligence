---
id: R-AI-6
severity: medium
status: mitigated
owner: Andy
---

# R-AI-6

**Risk:** Agent evals (AI-6) give a PR's procedures, `AGENTS.md` and cases to a live model with the model credential. A PR can weaken its own cases or baselines, or edit its workflow to run its code with the secret (R2, R5).

**Mitigation / next step:** Base-commit runner, no dependencies; the credential reaches only Claude Code, in an env holding nothing else; the agent reads only its workspace, no hooks. Cases are data; PR file names never echoed. No stub. Andy reviews case edits. Forks get no secret. Capped; spend-limited. Residual: R2.
