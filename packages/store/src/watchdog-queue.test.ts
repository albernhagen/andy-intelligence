import { watchdogQueueContract } from "@andy/contracts/testing";
import { describe, expect, it } from "vitest";
import { CloudTasksWatchdogQueue, type TaskCreator } from "./watchdog-queue";

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
  new CloudTasksWatchdogQueue({
    queue: QUEUE,
    publicUrl: PUBLIC_URL,
    invokerEmail: INVOKER,
    client,
  });

watchdogQueueContract("cloud-tasks (fake client)", async () => make(new FakeCloudTasks()));

describe("CloudTasksWatchdogQueue", () => {
  it("GivenARun_WhenScheduled_ThenANamedTaskPostsToTheWatchdogAtTheDeadlineWithTheInvokersToken", async () => {
    const client = new FakeCloudTasks();
    await make(client).schedule({ runId: "abc", at: "2026-11-04T12:45:00.000Z" });
    expect(client.tasks).toEqual([
      {
        parent: QUEUE,
        task: {
          name: `${QUEUE}/tasks/abc`,
          scheduleTime: { seconds: Date.parse("2026-11-04T12:45:00.000Z") / 1000 },
          dispatchDeadline: { seconds: 60 },
          httpRequest: {
            url: `${PUBLIC_URL}/runs/abc/watchdog`,
            httpMethod: "POST",
            oidcToken: { serviceAccountEmail: INVOKER, audience: PUBLIC_URL },
          },
        },
      },
    ]);
  });

  it("GivenCloudTasksFails_WhenScheduled_ThenTheErrorSurfaces", async () => {
    const queue = make({
      createTask: async () => {
        throw Object.assign(new Error("7 PERMISSION_DENIED"), { code: 7 });
      },
    });
    await expect(queue.schedule({ runId: "abc", at: "2026-11-04T12:45:00.000Z" })).rejects.toThrow(
      "PERMISSION_DENIED",
    );
  });
});
