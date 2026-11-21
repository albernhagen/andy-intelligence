# 2026-11-21 — DORA panel (AI-200: M6.15: DORA panel)

Dashboards now shows a project's four DORA metrics (ADR-0040) over the last 30 or 90 days, from the deployment records AI-161: M6.3: Deployment record added. Nothing writes deployments yet (M6.4), so the panel shows its empty state until then.

- **Read:** `GET /api/projects/{p}/dora`, signed-in, computed on request by `DoraReader` (`packages/domain/src/dora-report.ts`) with `doraMetrics`. Reads: the project, one page of at most 100 production deployments, `latestGood`. A full page that doesn't reach back 90 days says `partial` (ADR-0028). No MCP tool, no schema change.
- **Records → metrics:** a succeeded `deploy` or `promote` counts at its `finishedAt`; a succeeded `rollback` marks the deployment it replaced (`previousDeploymentId`) failed and restored at the rollback's `finishedAt`, and isn't counted itself. Failed deployment attempts never reached production and don't count.
- **Lead time:** deployment records hold the commit sha but not commit times, so lead time reads "Not measured" (`leadTimeMeasured: false`) until a later M6 slice records them.
- **Wiring:** `AppDeps.deployments` (Firestore store in `main.ts`; without it the report is empty), one line in `api-routes.ts`, the panel at the bottom of `/p/:id/dashboards`. Screenshot baseline updated with a fixed report.
