# Promote and rollback

Andy promotes a dev-verified image to prod, or rolls prod (or dev) back to an earlier revision, from the Releases page or MCP (AI-199: M6.12, ADR-0160). Each request is recorded with who asked and what will serve, then the project's `release.yml` runs; the request follows the workflow's reports to `succeeded` or `failed`, or shows `cancelled` when a deploy took its place in the queue.

| Rule     | Detail                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- |
| Who      | The owner only                                                                                  |
| Promote  | `dev-and-prod` projects; default the latest succeeded dev digest                                |
| Rollback | Default the succeeded revision before what serves now                                           |
| Refused  | `deployKind` `none`; promote on `prod-only`; an unknown digest or revision; what already serves |
| Cap      | One release request per project per minute (`429`)                                              |

**How to use:** the Releases page's **Promote to prod**, **Roll back prod** or **Roll back dev** (a confirm names what will serve); MCP `promote`, `rollback`, `list_release_requests`; `POST /api/projects/{id}/releases/promote|rollback`. Runbook: [`deploy-and-rollback.md`](../runbooks/deploy-and-rollback.md) §3a.
