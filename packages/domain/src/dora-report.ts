import {
  DEPLOYMENT_LIMITS,
  notFound,
  type Deployment,
  type DeploymentStore,
  type WorkTracker,
} from "@andy/contracts";
import { doraMetrics, type DoraDeployment, type DoraMetrics } from "./dora";

/**
 * A project's DORA report (AI-200: M6.15, ADR-0040) from its production deployment records
 * (AI-161: M6.3), over the last 30 and 90 days. Computed on read, never stored. Reads: the
 * project, one page of at most `DEPLOYMENT_LIMITS.maxPage` production deployments (newest first)
 * and the latest good one (ADR-0028).
 *
 * How records become DORA inputs:
 * - A deployment counts when it succeeded and is a `deploy` or `promote`, at its `finishedAt`.
 * - A succeeded `rollback` restores: the deployment it replaced (`previousDeploymentId`) failed,
 *   restored at the rollback's `finishedAt`. The rollback itself is not counted as a deployment.
 * - Lead time needs each change's commit time, which deployment records don't hold yet: it reads
 *   "not measured" (`leadTimeMeasured: false`) until a later M6 slice records it.
 */

export const DORA_WINDOWS_DAYS = [30, 90] as const;
const DAY_MS = 86_400_000;

export interface DoraWindowReport {
  days: (typeof DORA_WINDOWS_DAYS)[number];
  from: string;
  to: string;
  metrics: DoraMetrics;
}

export interface DoraReport {
  projectKey: string;
  windows: DoraWindowReport[];
  /** Commit times aren't recorded yet, so lead time has no samples. */
  leadTimeMeasured: boolean;
  /** The newest succeeded production deployment, or null. */
  latestGood: { gitSha: string; finishedAt: string | null } | null;
  /** The page cap was reached before the 90-day window's start: older deployments are missing. */
  partial: boolean;
}

/** DORA inputs from production deployment records (any order). */
export function doraDeployments(records: readonly Deployment[]): DoraDeployment[] {
  const restoredAt = new Map<string, string>();
  for (const r of records) {
    if (r.kind !== "rollback" || r.status !== "succeeded" || !r.finishedAt) continue;
    if (!r.previousDeploymentId) continue;
    const earlier = restoredAt.get(r.previousDeploymentId);
    // Several rollbacks of one deployment: the first restored it.
    if (!earlier || r.finishedAt < earlier) restoredAt.set(r.previousDeploymentId, r.finishedAt);
  }
  return records
    .filter((r) => r.environment === "prod" && r.status === "succeeded" && r.kind !== "rollback")
    .filter((r): r is Deployment & { finishedAt: string } => r.finishedAt !== null)
    .map((r) => ({
      deployedAt: r.finishedAt,
      changeCommittedAt: [],
      failed: restoredAt.has(r.id),
      restoredAt: restoredAt.get(r.id) ?? null,
    }));
}

/** The report from the records read. Pure: same input, same report. */
export function buildDoraReport(
  projectKey: string,
  records: readonly Deployment[],
  latestGood: Deployment | null,
  now: Date,
  pageFull: boolean,
): DoraReport {
  const inputs = doraDeployments(records);
  const to = now.toISOString();
  const windows = DORA_WINDOWS_DAYS.map((days) => {
    const from = new Date(now.getTime() - days * DAY_MS).toISOString();
    return { days, from, to, metrics: doraMetrics(inputs, { from, to }) };
  });
  const oldest = records.at(-1)?.startedAt;
  const widestFrom = windows.at(-1)!.from;
  return {
    projectKey,
    windows,
    leadTimeMeasured: false,
    latestGood: latestGood
      ? { gitSha: latestGood.gitSha, finishedAt: latestGood.finishedAt }
      : null,
    partial: pageFull && oldest !== undefined && oldest > widestFrom,
  };
}

/** Reads a project's report; with no deployment store every window is empty. */
export class DoraReader {
  constructor(
    private readonly tracker: Pick<WorkTracker, "getProject">,
    private readonly deployments: Pick<DeploymentStore, "list" | "latestGood"> | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async report(projectId: string): Promise<DoraReport> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const [records, latestGood] = this.deployments
      ? await Promise.all([
          this.deployments.list(projectId, "prod", DEPLOYMENT_LIMITS.maxPage),
          this.deployments.latestGood(projectId, "prod"),
        ])
      : [[], null];
    return buildDoraReport(
      project.key,
      records,
      latestGood,
      this.now(),
      records.length >= DEPLOYMENT_LIMITS.maxPage,
    );
  }
}
