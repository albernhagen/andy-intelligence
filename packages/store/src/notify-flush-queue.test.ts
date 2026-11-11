import { notifyFlushQueueContract } from "@andy/contracts/testing";
import { describe, expect, it } from "vitest";
import { CloudTasksNotifyFlushQueue } from "./notify-flush-queue";
import type { TaskCreator } from "./watchdog-queue";

const QUEUE = "projects/p/locations/us-central1/queues/run-watchdog";
const PUBLIC_URL = "https://ai.example.com";
const INVOKER = "tasks-invoker@p.iam.gserviceaccount.com";

/** Stands in for Cloud Tasks: rejects a second task with the same name, as the API does. */
class FakeCloudTasks implements TaskCreator {
  readonly tasks: Parameters<TaskCreator["createTask"]>[0][] = [];
  async createTask(request: Parameters<TaskCreator["createTask"]>[0]): Promise<unknown> {
    if (this.tasks.some((t) => t.task.name === request.task.name)) {
      throw Object.assign(new Error("6 ALREADY_EXISTS"), { code: 6 });
    }
    this.tasks.push(request);
    return [request.task];
  }
}

const make = (client: TaskCreator) =>
  new CloudTasksNotifyFlushQueue({
    queue: QUEUE,
    publicUrl: PUBLIC_URL,
    invokerEmail: INVOKER,
    client,
  });

notifyFlushQueueContract("cloud-tasks (fake client)", async () => make(new FakeCloudTasks()));

describe("CloudTasksNotifyFlushQueue", () => {
  it("GivenAWindowEnd_WhenScheduled_ThenANamedTaskPostsToTheFlushEndpointWithTheInvokersToken", async () => {
    const client = new FakeCloudTasks();
    const at = "2026-11-10T12:10:00.000Z";
    await make(client).schedule(at);
    expect(client.tasks).toEqual([
      {
        parent: QUEUE,
        task: {
          name: `${QUEUE}/tasks/notify-email-${Date.parse(at)}`,
          scheduleTime: { seconds: Date.parse(at) / 1000 },
          dispatchDeadline: { seconds: 60 },
          httpRequest: {
            url: `${PUBLIC_URL}/notify/email/flush`,
            httpMethod: "POST",
            oidcToken: { serviceAccountEmail: INVOKER, audience: PUBLIC_URL },
          },
        },
      },
    ]);
  });

  it("GivenAnotherError_WhenScheduled_ThenItIsThrown", async () => {
    const client: TaskCreator = { createTask: async () => Promise.reject(new Error("denied")) };
    await expect(make(client).schedule("2026-11-10T12:10:00.000Z")).rejects.toThrow("denied");
  });
});
