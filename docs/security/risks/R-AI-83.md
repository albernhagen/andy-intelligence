---
id: R-AI-83
severity: medium
status: open
owner: Andy
---

# R-AI-83

**Risk:** Managed repos (ADR-0096): pushers there read its Claude token (R2); registering opens the push grant without a PR (R19); a bad merge here hits every repo.

**Mitigation / next step:** Built (AI-105): only a registered repo's `agent-run.yml` on `main`, our executor, a task of its project; Andy installs and registers; `main`-only environment; Andy merges `.github/`. Built (AI-106): the baseline's caller calls only our executor at `main`; a test fails if that reference changes.
