# Releases page

A project's deployments, one column per environment (dev, then prod, or prod alone), newest first (AI-189: M6.10, ADR-0114). Each deployment shows its status, revision (or short commit), time and actor; opened, it shows the commit, the environment's URL, the agent task that started it, the tickets it shipped and its [release notes](release-notes.md), grouped by milestone epic. Read-only; promote and rollback sit above the columns ([promote and rollback](promote-and-rollback.md), AI-199: M6.12).

**How to use:** What's new → **Releases** in a project (`/p/ai/releases`), or Cmd+K → Releases. On a phone the environments show one at a time (`dev` / `prod` tabs). MCP `list_releases` reads the same listing.

| Shows                         | When                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Succeeded, Failed, Deploying  | The deployment's status (`started` reads Deploying)                                       |
| Promote, Rollback             | A deployment that was not a new build                                                     |
| Actor                         | "Andy" (a signed-in user), "an agent task" (`agent:`), "the deploy workflow"              |
| No release lines, with why    | First deployment, same commit, behind the previous one, or unavailable                    |
| "This project doesn't deploy" | Deploy kind `none` ([deploy kind](deploy-kind.md)); links the runbook                     |
| "No deployments to prod yet"  | A `cloud-run` environment with none; links [`project-env.md`](../runbooks/project-env.md) |

Release-note text is PR authors' text, shown as plain text. Code: `apps/web/src/pages/ReleasesPage.tsx`, `apps/web/src/components/releases/`.
