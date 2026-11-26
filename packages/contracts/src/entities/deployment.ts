import { z } from "zod";
import { Id, Timestamp } from "./common";
import { StoredRelease } from "./release-entry";

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
  // Fits the callback's 1 KB report body with every other field.
  url: 512,
  request: 80,
} as const;

/** Where a deployment runs: a long-lived environment, or a pull request's preview. */
export const DeploymentEnvironment = z.enum(["dev", "prod", "preview"]);
export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironment>;

/** `deploy`: a new build; `promote`: an image already tested elsewhere; `rollback`: an earlier one. */
export const DeploymentKind = z.enum(["deploy", "promote", "rollback"]);
export type DeploymentKind = z.infer<typeof DeploymentKind>;

/** An `https` origin or URL; no credentials in it. */
export const DeploymentUrl = z
  .string()
  .max(DEPLOYMENT_LIMITS.url)
  .url()
  .refine((u) => {
    // Zod runs this even when `.url()` failed, so an unparsable value must not throw here.
    if (!URL.canParse(u)) return false;
    const url = new URL(u);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  }, "an https URL without credentials");

/** The control plane's id for a promote or rollback request (ADR-0114). */
export const DeploymentRequestId = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_-]{1,${DEPLOYMENT_LIMITS.request}}$`));

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
    /** Where the deployed environment answers, for verification tests (AI-190: M6.11); null if not reported. */
    url: DeploymentUrl.nullable().default(null),
    /** The control plane's request that started a promote or rollback (AI-190: M6.11); null otherwise. */
    request: DeploymentRequestId.nullable().default(null),
    /** Its release, once computed (AI-183: M6.9): written at most once, by `cacheRelease`. */
    release: StoredRelease.nullable().default(null),
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

/** What `record` takes: everything but the id, which the store assigns, and the cached release. */
export type NewDeployment = Omit<z.input<typeof Deployment>, "id" | "release">;

/** The environments a deploy or release workflow reports to; previews report elsewhere (ADR-0114). */
export const ReportedEnvironment = DeploymentEnvironment.extract(["dev", "prod"]);
export type ReportedEnvironment = z.infer<typeof ReportedEnvironment>;

/**
 * The body of a workflow's start report (AI-180: M6.4, widened by AI-190: M6.11). Only the image
 * digest is required, so `deploy.yml` from before M6.11 keeps working (environment `prod`, kind
 * `deploy`). The token, never this body, names the repository and the workflow.
 */
export const DeploymentStartReport = z.strictObject({
  imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  environment: ReportedEnvironment.optional(),
  kind: DeploymentKind.optional(),
  url: DeploymentUrl.optional(),
  request: DeploymentRequestId.optional(),
});
export type DeploymentStartReport = z.infer<typeof DeploymentStartReport>;

/** How a started deployment ends. */
export const DeploymentFinish = z.object({
  status: z.enum(["succeeded", "failed"]),
  finishedAt: Timestamp,
  /** Set when the revision became known only at the end. */
  revision: z.string().min(1).max(DEPLOYMENT_LIMITS.revision).optional(),
});
export type DeploymentFinish = z.infer<typeof DeploymentFinish>;

/**
 * The deployment after `finish` (shared by every DeploymentStore, so they can't drift): status and
 * time from the finish; the revision only when the finish names one, so a known revision is never
 * wiped by an absent or undefined field.
 */
export function finishedDeployment(current: Deployment, finish: DeploymentFinish): Deployment {
  const change = DeploymentFinish.parse(finish);
  return Deployment.parse({
    ...current,
    status: change.status,
    finishedAt: change.finishedAt,
    revision: change.revision ?? current.revision,
  });
}

/**
 * The deployment with its release cached (shared by every DeploymentStore): unchanged when one is
 * already cached, so a release is kept at most once.
 */
export function withCachedRelease(current: Deployment, release: StoredRelease): Deployment {
  if (current.release) return current;
  return Deployment.parse({ ...current, release: StoredRelease.parse(release) });
}

/** A listing's page size, clamped to 1..`maxPage`; `defaultPage` when not given. */
export function deploymentPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEPLOYMENT_LIMITS.defaultPage;
  return Math.min(DEPLOYMENT_LIMITS.maxPage, Math.max(1, Math.trunc(limit)));
}
