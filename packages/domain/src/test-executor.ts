import {
  InMemoryCodeHost,
  InMemoryExecutor,
  type RunHandle,
  type RunRequest,
} from "@andy/contracts";

// Test helper for the domain tests; not exported from the package.

export const EXECUTOR_REF =
  "albernhagen/andy-intelligence/.github/workflows/claude-executor.yml@refs/heads/main";

/**
 * An executor that dispatches a workflow on the fake code host, like the Actions adapter, so runs
 * get an executor identity to call back with.
 */
export class WorkflowExecutor extends InMemoryExecutor {
  constructor(private readonly host: InMemoryCodeHost) {
    super();
  }
  override async cancel(handle: RunHandle): Promise<void> {
    if (handle.executor) await this.host.cancelWorkflowRun(handle.executor.repo, handle.externalId);
  }
  override async start(req: RunRequest): Promise<RunHandle> {
    await super.start(req);
    const credential = req.billingType === "pay_per_use" ? "api_key" : "subscription";
    const d = await this.host.dispatchWorkflow(req.projectRef, "agent-run.yml", {
      run_id: req.runId,
      credential,
    });
    if (!d) throw new Error("not installed");
    return {
      runId: req.runId,
      externalId: d.id,
      url: d.url,
      executor: { repo: req.projectRef, ref: EXECUTOR_REF, externalId: d.id },
    };
  }
}

/** A valid build run result (BuildOutput), as the agent returns it. */
export const buildOutput = {
  summary: "Adds the board.",
  plan: {
    files: ["apps/web/src/pages/BoardPage.tsx"],
    steps: ["Write the page", "Test it"],
    tests: ["GivenTickets_WhenTheBoardOpens_ThenTheyShow"],
    riskiestStep: "Ordering by rank",
    rejectedAlternatives: ["A table: the board is the design"],
  },
  deviations: [],
  verification: [{ command: "pnpm test", passed: true, output: "12 passed" }],
  failingTestFiles: [],
};
