import { CloudTasksClient } from "@google-cloud/tasks";
import type { NotifyFlushQueue } from "@andy/contracts";
import type { TaskCreator } from "./watchdog-queue";

/** gRPC ALREADY_EXISTS: this window's flush is queued already. */
const ALREADY_EXISTS = 6;

/** The control plane's email flush endpoint (apps/api `NOTIFY_FLUSH_PATH`). */
export const notifyFlushUrl = (publicUrl: string) => `${publicUrl}/notify/email/flush`;

export interface CloudTasksNotifyFlushQueueOptions {
  /** The run watchdog's queue, shared: its rate, concurrency and retries are capped in Terraform. */
  queue: string;
  publicUrl: string;
  invokerEmail: string;
  client?: TaskCreator;
}

/**
 * NotifyFlushQueue on Cloud Tasks (AI-77): one named task per batching window (its end time),
 * so a second schedule for the window is a no-op. Delivered as a POST with the invoker's OIDC
 * token, like the run watchdog.
 */
export class CloudTasksNotifyFlushQueue implements NotifyFlushQueue {
  private readonly client: TaskCreator;

  constructor(private readonly options: CloudTasksNotifyFlushQueueOptions) {
    this.client = options.client ?? (new CloudTasksClient() as unknown as TaskCreator);
  }

  async schedule(at: string): Promise<void> {
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) throw new Error(`invalid flush time ${at}`);
    try {
      await this.client.createTask({
        parent: this.options.queue,
        task: {
          name: `${this.options.queue}/tasks/notify-email-${ms}`,
          scheduleTime: { seconds: Math.ceil(ms / 1000) },
          dispatchDeadline: { seconds: 60 },
          httpRequest: {
            url: notifyFlushUrl(this.options.publicUrl),
            httpMethod: "POST",
            oidcToken: {
              serviceAccountEmail: this.options.invokerEmail,
              audience: this.options.publicUrl,
            },
          },
        },
      });
    } catch (err) {
      if ((err as { code?: number }).code !== ALREADY_EXISTS) throw err;
    }
  }
}
