import { CloudTasksClient } from "@google-cloud/tasks";
import { QueuedCheck, WatchdogCheck, queuedCheckKey, type WatchdogQueue } from "@andy/contracts";

/** gRPC ALREADY_EXISTS: a task with this name was created before (or recently deleted). */
const ALREADY_EXISTS = 6;

/** The control plane's watchdog endpoint for a run (apps/api `RUN_WATCHDOG_PATH`). */
export const watchdogUrl = (publicUrl: string, runId: string) =>
  `${publicUrl}/runs/${encodeURIComponent(runId)}/watchdog`;

/** A local run's lease check (apps/api `RUN_LEASE_PATH`, ADR-0089). */
export const leaseUrl = (publicUrl: string, runId: string) =>
  `${publicUrl}/runs/${encodeURIComponent(runId)}/lease`;

/** A runner's away check (apps/api `RUNNER_AWAY_PATH`, ADR-0089). */
export const runnerAwayUrl = (publicUrl: string, runnerId: string) =>
  `${publicUrl}/runners/${encodeURIComponent(runnerId)}/away`;

/** The one Cloud Tasks call this adapter makes; a test seam. */
export interface TaskCreator {
  createTask(request: {
    parent: string;
    task: {
      name: string;
      scheduleTime: { seconds: number };
      dispatchDeadline: { seconds: number };
      httpRequest: {
        url: string;
        httpMethod: "POST";
        oidcToken: { serviceAccountEmail: string; audience: string };
      };
    };
  }): Promise<unknown>;
}

export interface CloudTasksWatchdogQueueOptions {
  /** Full queue name: `projects/{p}/locations/{r}/queues/run-watchdog`. */
  queue: string;
  /** `PUBLIC_URL`: the task's target host and its OIDC token's audience (§9, ADR-0044). */
  publicUrl: string;
  /** The invoker service account whose OIDC token each delivery carries. */
  invokerEmail: string;
  client?: TaskCreator;
}

/**
 * WatchdogQueue on Cloud Tasks (ARCHITECTURE §7.1, §9). One named task per run (task ID =
 * run ID), so a second schedule for the run is rejected by Cloud Tasks and reads as
 * "duplicate". Each delivery is a POST to the watchdog endpoint with an OIDC token for the
 * invoker service account. The queue's rate, concurrency and retries are capped in Terraform.
 */
export class CloudTasksWatchdogQueue implements WatchdogQueue {
  private readonly client: TaskCreator;

  constructor(private readonly options: CloudTasksWatchdogQueueOptions) {
    this.client = options.client ?? (new CloudTasksClient() as unknown as TaskCreator);
  }

  async schedule(check: WatchdogCheck): Promise<"scheduled" | "duplicate"> {
    const { runId, at } = WatchdogCheck.parse(check);
    return this.create(runId, at, watchdogUrl(this.options.publicUrl, runId));
  }

  /** Lease and runner-away checks (ADR-0089): one named task per key, on the same queue. */
  async scheduleCheck(check: QueuedCheck): Promise<"scheduled" | "duplicate"> {
    const parsed = QueuedCheck.parse(check);
    const url =
      parsed.kind === "lease"
        ? leaseUrl(this.options.publicUrl, parsed.runId)
        : runnerAwayUrl(this.options.publicUrl, parsed.runnerId);
    return this.create(queuedCheckKey(parsed), parsed.at, url);
  }

  private async create(
    taskId: string,
    at: string,
    url: string,
  ): Promise<"scheduled" | "duplicate"> {
    try {
      await this.client.createTask({
        parent: this.options.queue,
        task: {
          name: `${this.options.queue}/tasks/${taskId}`,
          scheduleTime: { seconds: Math.ceil(Date.parse(at) / 1000) },
          // Matches the Cloud Run request timeout.
          dispatchDeadline: { seconds: 60 },
          httpRequest: {
            url,
            httpMethod: "POST",
            oidcToken: {
              serviceAccountEmail: this.options.invokerEmail,
              audience: this.options.publicUrl,
            },
          },
        },
      });
      return "scheduled";
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) return "duplicate";
      throw err;
    }
  }
}
