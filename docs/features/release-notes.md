# Release notes

A deployment's release notes: the PRs merged since the previous succeeded deployment to the same environment, oldest first, one "What changed" line each from the PR's stored note ([What's new](whats-new.md), ADR-0121), grouped by milestone epic. A PR with no stored note shows its title marked "no note"; a commit with no PR, "no PR". No model call; note text stays plain text (it quotes PR authors). ADR-0114 "Release notes", AI-169: M6.8.

**How to use:** MCP `list_releases` or `GET /api/projects/{id}/releases?env=&limit=` (AI-183: M6.9): `prod` (default) or `dev` deployments, newest first (20, at most 100), each with its shipped tickets and release notes. Code: `ReleaseReader` (`domain/src/releases.ts`).

**Computed once:** kept on the deployment (`Deployment.release`) after the first read, so one compare per release. Not kept: `unavailable`, a `started` deployment, or one with a `started` deployment since the previous succeeded one. Epics and titles are read fresh each time.

| Answer (`status`) | When                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `listed`          | The PRs between the two deployments' commits; `truncated` past 100 commits                            |
| `first`           | No earlier succeeded deployment to this environment                                                   |
| `same_commit`     | The previous succeeded deployment shipped the same commit                                             |
| `not_ahead`       | This commit is behind the previous one (a rollback): nothing new ships                                |
| `unavailable`     | The code host could not compare, or no succeeded deployment among the latest 100; `reason` says which |

How a PR is found: a squash merge's title ends with `(#<n>)`; its note `pr-<n>` is read.
