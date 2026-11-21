import { z } from "zod";
import { Id, Timestamp } from "./common";

/**
 * A deployment of a project to one environment (M6: Dev → prod releases, AI-161: M6.3). Every
 * later M6 slice reads these records: release notes, verification, promote and rollback, DORA.
 * Written by the control plane only, from deploy workflows (M6.4).
 */

/** Caps (ADR-0028): a listing never returns more than `maxPage` deployments. */
export const DEPLOYMENT_LIMITS = {
  defaultPage: 20,
  maxPage: 100,
  actor: 200,
  revision: 100,
} as const;

/** Where a deployment runs: a long-lived environment, or a pull request's preview. */
export const DeploymentEnvironment = z.enum(["dev", "prod", "preview"]);
export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironment>;

/** `deploy`: a new build; `promote`: an image already tested elsewhere; `rollback`: an earlier one. */
export const DeploymentKind = z.enum(["deploy", "promote", "rollback"]);
export type DeploymentKind = z.infer<typeof DeploymentKind>;

export const DeploymentStatus = z.enum(["started", "succeeded", "failed"]);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

export const Deployment = z
  .object({
    /** Assigned by the store when the deployment is recorded. */
    id: z.string().regex(/^[A-Za-z0-9-]{1,80}$/),
    projectId: Id,
    environment: DeploymentEnvironment,
    /** The container image deployed, by content digest. */
    imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    /** The commit the image was built from. */
    gitSha: z.string().regex(/^[0-9a-f]{40}$/),
    /** The runtime's name for what is now serving (a revision); null until it is known. */
    revision: z.string().min(1).max(DEPLOYMENT_LIMITS.revision).nullable().default(null),
    kind: DeploymentKind,
    status: DeploymentStatus,
    startedAt: Timestamp,
    /** Null while `started`; set when it succeeded or failed. */
    finishedAt: Timestamp.nullable().default(null),
    /** Who or what started it: `user:<uid>`, `agent:<runId>` or `system`. */
    actor: z.string().min(1).max(DEPLOYMENT_LIMITS.actor),
    /** The deployment this one replaced in the same environment, if any. */
    previousDeploymentId: z.string().min(1).max(80).nullable().default(null),
  })
  .refine((d) => (d.status === "started") === (d.finishedAt === null), {
    message: "finishedAt is set exactly when the deployment has finished",
    path: ["finishedAt"],
  })
  .refine((d) => d.finishedAt === null || Date.parse(d.finishedAt) >= Date.parse(d.startedAt), {
    message: "finishedAt is before startedAt",
    path: ["finishedAt"],
  });
export type Deployment = z.infer<typeof Deployment>;

/** What `record` takes: everything but the id, which the store assigns. */
export type NewDeployment = Omit<z.input<typeof Deployment>, "id">;

/** How a started deployment ends. */
export const DeploymentFinish = z.object({
  status: z.enum(["succeeded", "failed"]),
  finishedAt: Timestamp,
  /** Set when the revision became known only at the end. */
  revision: z.string().min(1).max(DEPLOYMENT_LIMITS.revision).optional(),
});
export type DeploymentFinish = z.infer<typeof DeploymentFinish>;

/** A listing's page size, clamped to 1..`maxPage`; `defaultPage` when not given. */
export function deploymentPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEPLOYMENT_LIMITS.defaultPage;
  return Math.min(DEPLOYMENT_LIMITS.maxPage, Math.max(1, Math.trunc(limit)));
}
