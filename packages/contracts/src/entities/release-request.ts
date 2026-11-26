import { z } from "zod";
import { Id, Timestamp } from "./common";
import { DEPLOYMENT_LIMITS, DeploymentRequestId, ReportedEnvironment } from "./deployment";

/**
 * A promote or rollback the owner asked for (AI-199: M6.12, ADR-0160). The control plane records
 * it before it starts the project's `release.yml`, passes its id as the workflow's `request`
 * input, and matches the workflow's deployment reports to it. It is the audit record of who asked
 * for what change to which environment, and when.
 */

/** Caps (ADR-0028). */
export const RELEASE_REQUEST_LIMITS = {
  /** One release request per project per this many milliseconds (the ticket's rate cap). */
  minGapMs: 60_000,
  defaultPage: 20,
  maxPage: 50,
  error: 500,
  runUrl: 512,
} as const;

export const ReleaseAction = z.enum(["promote", "rollback"]);
export type ReleaseAction = z.infer<typeof ReleaseAction>;

/**
 * - `requested`: recorded; the workflow is being started.
 * - `dispatch_failed`: the code host refused to start it (`error` says why); nothing changed.
 * - `dispatched`: the workflow run exists (`runId`), no deployment reported yet.
 * - `started`: the workflow reported its start (`deploymentId`).
 * - `succeeded` / `failed`: the workflow reported its end.
 * - `cancelled`: the run ended cancelled before it reported an end (a deploy took its place in
 *   the queue, or someone cancelled it).
 * - `ended_unreported`: the run ended without reporting an end (e.g. its start report was
 *   refused, or the report failed).
 */
export const ReleaseRequestStatus = z.enum([
  "requested",
  "dispatch_failed",
  "dispatched",
  "started",
  "succeeded",
  "failed",
  "cancelled",
  "ended_unreported",
]);
export type ReleaseRequestStatus = z.infer<typeof ReleaseRequestStatus>;

/** Statuses after which nothing changes the request. */
export const FINAL_RELEASE_REQUEST_STATUSES: readonly ReleaseRequestStatus[] = [
  "dispatch_failed",
  "succeeded",
  "failed",
  "cancelled",
  "ended_unreported",
];

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Revision = z.string().min(1).max(DEPLOYMENT_LIMITS.revision);

export const ReleaseRequest = z.object({
  /** Assigned by the store; also the workflow's `request` input. */
  id: DeploymentRequestId,
  projectId: Id,
  action: ReleaseAction,
  environment: ReportedEnvironment,
  /** The image digest that will serve: promote ships it; rollback returns to its revision. */
  digest: Digest,
  /** Rollback only: the revision traffic returns to. Null for promote. */
  revision: Revision.nullable(),
  /** The succeeded deployment the digest (and revision) came from. */
  sourceDeploymentId: z.string().min(1).max(80),
  /** Who asked: `user:<uid>` (never an email). */
  actor: z.string().min(1).max(DEPLOYMENT_LIMITS.actor),
  createdAt: Timestamp,
  status: ReleaseRequestStatus,
  /** The workflow run, once started. */
  runId: z
    .string()
    .regex(/^[0-9]{1,20}$/)
    .nullable()
    .default(null),
  runUrl: z.string().url().max(RELEASE_REQUEST_LIMITS.runUrl).nullable().default(null),
  /** The deployment the workflow reported for it. */
  deploymentId: z.string().min(1).max(80).nullable().default(null),
  /** Why it was refused or ended without a result. */
  error: z.string().max(RELEASE_REQUEST_LIMITS.error).nullable().default(null),
  updatedAt: Timestamp,
});
export type ReleaseRequest = z.infer<typeof ReleaseRequest>;

/** What `create` takes: everything but the id the store assigns. */
export type NewReleaseRequest = Omit<z.input<typeof ReleaseRequest>, "id">;

/** The fields a status change may set. */
export const ReleaseRequestPatch = z
  .object({
    status: ReleaseRequestStatus,
    runId: ReleaseRequest.shape.runId.unwrap().unwrap(),
    runUrl: ReleaseRequest.shape.runUrl.unwrap().unwrap(),
    deploymentId: ReleaseRequest.shape.deploymentId.unwrap().unwrap(),
    error: ReleaseRequest.shape.error.unwrap().unwrap(),
    updatedAt: Timestamp,
  })
  .partial()
  .required({ status: true, updatedAt: true });
export type ReleaseRequestPatch = z.infer<typeof ReleaseRequestPatch>;

/** The request after `patch` (shared by every store, so they can't drift); `error` is trimmed. */
export function patchedReleaseRequest(
  current: ReleaseRequest,
  patch: ReleaseRequestPatch,
): ReleaseRequest {
  const change = ReleaseRequestPatch.parse({
    ...patch,
    ...(patch.error !== undefined
      ? { error: patch.error.slice(0, RELEASE_REQUEST_LIMITS.error) }
      : {}),
  });
  return ReleaseRequest.parse({ ...current, ...change });
}

/** A listing's page size, clamped to 1..`maxPage`; `defaultPage` when not given. */
export function releaseRequestPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return RELEASE_REQUEST_LIMITS.defaultPage;
  return Math.min(RELEASE_REQUEST_LIMITS.maxPage, Math.max(1, Math.trunc(limit)));
}
