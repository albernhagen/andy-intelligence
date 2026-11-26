# Release notes

A deployment's release notes: the PRs merged between the previous succeeded deployment to the same environment and this one, oldest first, one "What changed" line each from the note stored when the PR merged ([What's new](whats-new.md), ADR-0121), grouped by milestone epic. A PR with no stored note shows its title marked "no note"; a commit with no PR, "no PR". No model call; note text stays plain text (it quotes PR authors). ADR-0114 "Release notes", AI-169: M6.8.

**How to use:** Not on a screen or MCP tool yet: AI-183: M6.9 adds the Releases API and MCP tools. In code: `ReleaseReader.read(projectId, deploymentId)` and `renderReleaseText` in `packages/domain/src/releases.ts`.

| Answer (`status`) | When                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `listed`          | The PRs between the two deployments' commits; `truncated` past 100 commits                            |
| `first`           | No earlier succeeded deployment to this environment                                                   |
| `same_commit`     | The previous succeeded deployment shipped the same commit                                             |
| `not_ahead`       | This commit is behind the previous one (a rollback): nothing new ships                                |
| `unavailable`     | The code host could not compare, or no succeeded deployment among the latest 100; `reason` says which |

How a PR is found: one code-host compare of the two commits (at most 100 commits); each squash merge's title ends with `(#<n>)`, its PR number, whose stored note (`pr-<n>`) is read.
