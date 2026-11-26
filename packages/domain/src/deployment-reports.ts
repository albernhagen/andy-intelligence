import type {
  Deployment,
  DeploymentKind,
  DeploymentStartReport,
  ReportedEnvironment,
} from "@andy/contracts";

/**
 * Who may report which deployment (AI-180: M6.4, widened by AI-190: M6.11; ADR-0114, "The release
 * contract every kind meets"). Two workflows on `main` report: `deploy.yml` (a new build) and
 * `release.yml` (promote or rollback). Pure: the API verifies the token and stores the result.
 */

/** The workflow files that may report, under `.github/workflows/`, each only on `main`. */
export const REPORTING_WORKFLOWS = { deploy: "deploy.yml", release: "release.yml" } as const;
export type ReportingWorkflow = keyof typeof REPORTING_WORKFLOWS;

/** The token's `workflow_ref` a repo's reporting workflow carries. */
export function reportingWorkflowRef(repository: string, workflow: ReportingWorkflow): string {
  return `${repository}/.github/workflows/${REPORTING_WORKFLOWS[workflow]}@refs/heads/main`;
}

/** Which reporting workflow a token comes from, or null: another file, branch, tag or repo. */
export function reportingWorkflow(
  repository: string,
  workflowRef: string | undefined,
): ReportingWorkflow | null {
  for (const workflow of Object.keys(REPORTING_WORKFLOWS) as ReportingWorkflow[]) {
    if (workflowRef === reportingWorkflowRef(repository, workflow)) return workflow;
  }
  return null;
}

/**
 * What a start report records. `deploy`: the token's commit. A release (promote or rollback)
 * ships a build made earlier, so its commit is the one a succeeded deployment of the same digest
 * in `sourceEnvironment` recorded; the token's commit is only `main` when the run started.
 */
export type StartPlan =
  | {
      ok: true;
      workflow: "deploy";
      environment: ReportedEnvironment;
      kind: "deploy";
    }
  | {
      ok: true;
      workflow: "release";
      environment: ReportedEnvironment;
      kind: Exclude<DeploymentKind, "deploy">;
      sourceEnvironment: ReportedEnvironment;
    }
  | { ok: false; reason: string };

/** The start rule: which kinds and environments each workflow may report. */
export function planStart(workflow: ReportingWorkflow, report: DeploymentStartReport): StartPlan {
  if (workflow === "deploy") {
    if (report.kind !== undefined && report.kind !== "deploy") {
      return { ok: false, reason: "deploy.yml reports only kind deploy" };
    }
    if (report.request !== undefined) {
      return { ok: false, reason: "a request belongs to a release, not a deploy" };
    }
    // Reports from before M6.11 name no environment: the control plane deploys only to prod.
    return { ok: true, workflow, environment: report.environment ?? "prod", kind: "deploy" };
  }
  if (report.kind !== "promote" && report.kind !== "rollback") {
    return { ok: false, reason: "release.yml reports kind promote or rollback" };
  }
  if (report.environment === undefined) {
    return { ok: false, reason: "a release names its environment" };
  }
  if (report.kind === "promote") {
    // Promote ships what dev verified to prod (ADR-0114); there is nothing before dev.
    if (report.environment !== "prod") return { ok: false, reason: "promote goes to prod" };
    return { ok: true, workflow, environment: "prod", kind: "promote", sourceEnvironment: "dev" };
  }
  return {
    ok: true,
    workflow,
    environment: report.environment,
    kind: "rollback",
    sourceEnvironment: report.environment,
  };
}

/** The newest succeeded deployment of `imageDigest` among `deployments` (newest first), or null. */
export function releaseSource(
  deployments: readonly Deployment[],
  imageDigest: string,
): Deployment | null {
  return deployments.find((d) => d.status === "succeeded" && d.imageDigest === imageDigest) ?? null;
}

/**
 * Whether a workflow may finish a started deployment: same project, and the workflow that starts
 * that kind. A deploy also needs the same commit; a release can't match on commit (the record
 * holds the shipped build's commit), and one release runs at a time per environment.
 */
export function mayFinish(
  deployment: Pick<Deployment, "projectId" | "gitSha" | "kind">,
  caller: { workflow: ReportingWorkflow; projectId: string; sha: string },
): boolean {
  if (deployment.projectId !== caller.projectId) return false;
  if (caller.workflow === "deploy") {
    return deployment.kind === "deploy" && deployment.gitSha === caller.sha;
  }
  return deployment.kind === "promote" || deployment.kind === "rollback";
}
