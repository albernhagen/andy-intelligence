# Agent rules — `.github/` (workflows, repo config)

Loaded when you work here; the root `AGENTS.md` still applies.

- Pin every third-party action to a full commit SHA with a version comment. Never use `pull_request_target`. Set `permissions: {}` at the top and grant the fewest scopes per job.
- Workflows are thin callers: the steps live in composite actions in `platform/actions/` so managed repos get them (ADR-0038). A new guardrail gets its ARCHITECTURE §8.1 row.
- Job names are required check names in `platform/baseline/github/ruleset-main.json`; renaming one breaks merges (a test compares them).
- A job that holds a write token or secrets must not run code from the PR (check out the base commit), and must say why in a comment.
- Run actionlint (`brew install actionlint`); CI runs it too.
