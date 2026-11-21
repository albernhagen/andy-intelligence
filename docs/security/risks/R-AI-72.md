---
id: R-AI-72
severity: medium
status: mitigated
owner: Andy
---

# R-AI-72

**Risk:** Sync runs (AI-72, ADR-0083) push to open agent PR branches with the App token on every move of `main`, without a person starting them. The agent reads both sides of each conflict (repo text written by agents and people) and could resolve one so the PR's meaning changes, or the push could overwrite work on the branch.

**Mitigation / next step:** Only PRs a build run opened, on its own branch; one run per PR, 3 a day; pause, quota and the global cap apply. A build's sandbox, scrub and token rule. No install from a tree whose manifests, lockfiles or `.npmrc` differ from `main`'s. The executor reruns the checks; the publish job checks the patch against build path rules and pushes a two-parent fast-forward merge (never force). Checks and both reviews rerun on the new head. Detail: agents-and-executors file. Residual: the checks verdict stops an honest-but-wrong agent, not a hostile one; Andy merges `AI` PRs by hand (`autoMerge: none`).
