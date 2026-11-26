# Threat model: Releases read

Detail on the releases read (AI-183: M6.9; part of M6: Dev → prod releases in `docs/architecture/milestones.md`, ADR-0114): a project's deployments to one environment, each with the tickets it shipped and its release notes, read from the records in [deployments.md](deployments.md). Risk register, assets and mitigations: [threat-model.md](threat-model.md). PRs that change this area update this file; the weekly system review edits only the main file.

## Trust boundaries and entry points

| Entry point                                                                                                                | Who can reach it  | Authn/authz                                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/projects/{id}/releases` (`apps/api/src/releases.ts`), MCP `list_releases` (`apps/api/src/mcp/tools-releases.ts`) | Signed-in callers | The `/api` sign-in and the project-access check (AI-252): a project the caller can't read is `404` (MCP: "not found"), before any read | Read-only. `env` is `dev` or `prod`, `limit` 1–100 (`400` otherwise). Note and commit text is PR authors' text: plain text, labelled data in the tool's text. The one write is the cached release on the deployment (`DeploymentStore.cacheRelease`, once per deployment, server-side). Code-host errors go to the log; the caller sees a fixed reason |

## Caps (ADR-0028)

| What               | Cap                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployments        | One listing of at most 100 per call                                                                                                                                                                                                                                  |
| Code-host compares | At most 20 new ones per call (the rest answer `unavailable` until a later read), 5 at once, 100 commits each; none once a release is kept. An `unavailable` answer is reused for 5 minutes (at most 1,000 remembered per instance) before its compare is tried again |
| Note reads         | At most 100 per compare                                                                                                                                                                                                                                              |
| Ticket reads       | One project ticket list per call, only when a note names a ticket                                                                                                                                                                                                    |

## Credentials

None new: compares go through the connected GitHub App (`ConnectedCodeHost`), as the release notes (AI-169: M6.8) do.

## Residual risks (R-AI-183)

- **A kept release is never recomputed.** A note stored after the first read (a backfill) isn't shown for that release, and a wrong answer the code host gave once stays. A later ticket can add a way to clear it.
- **PR text reaches MCP clients.** Release notes quote PR authors; the tool's text opens with a fixed line saying they are untrusted data, and every quoted line is flattened to one line (no newlines or control characters).
