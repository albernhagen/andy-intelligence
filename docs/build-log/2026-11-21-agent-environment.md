# 2026-11-21 — AI-106: M5.3: the `agent` environment for agent tasks' Claude token

- Andy answered ADR-0096 question 1 (via the coordinator): his first managed repos are public, so agent tasks read the Claude token from a GitHub environment `agent`, deployable from `main` only.
- Built in AI-106: the executor's `agent` job names the environment and checks the credential first; `context` no longer reads secrets. The caller still passes the secret by name (GitHub requires it); the environment's value wins when set.
- Safe before Andy's steps: an environment without the secret falls back to the repo secret. Runbook `agent-environment.md`.
- Found: the review agents run on PR branches and keep a repo copy of the token, so R2 stays open for them.
