import type {
  CodeHost,
  Executor,
  RunHandle,
  RunReport,
  RunRequest,
  RunStatus,
  WorkflowRun,
} from "@andy/contracts";
import { RunRequest as RunRequestSchema } from "@andy/contracts";

/**
 * The repo whose `claude-executor.yml` the callbacks must come from. Until M5: Multi-project in
 * parallel gives other repos a caller pinned to this repo, only this repo can run agents: its
 * `agent-run.yml` calls the executor locally, so the OIDC `job_workflow_ref` is this repo's
 * workflow on its default branch.
 */
export const PLATFORM_REPO = "albernhagen/andy-intelligence";

/** The per-project caller workflow the control plane dispatches (`.github/workflows/`). */
export const AGENT_RUN_WORKFLOW = "agent-run.yml";

/**
 * The platform's reusable workflow every Claude Code run must execute (§9 agent callback
 * auth): a callback whose OIDC `job_workflow_ref` differs is refused.
 */
export const CLAUDE_EXECUTOR_REF = `${PLATFORM_REPO}/.github/workflows/claude-executor.yml@refs/heads/main`;

/** Workflow input values for the run's credential (the workflow picks the secret). */
export const CREDENTIAL_INPUT = { subscription: "subscription", pay_per_use: "api_key" } as const;

/**
 * Executor for Claude Code on GitHub Actions (ARCHITECTURE §7.2): `start` dispatches the
 * project's `agent-run.yml` with only the run ID and the credential kind as inputs (inputs are
 * public in public repos). The workflow fetches its instructions and reports back over the
 * OIDC-authenticated callback; this adapter never sees the result directly.
 */
export class ClaudeCodeActionsExecutor implements Executor {
  /** Dispatches made by this instance; makes a retried `start` idempotent. */
  private readonly started = new Map<string, RunHandle>();

  constructor(
    private readonly host: CodeHost,
    private readonly options: { workflow?: string; executorRef?: string } = {},
  ) {}

  async start(req: RunRequest): Promise<RunHandle> {
    const parsed = RunRequestSchema.parse(req);
    const previous = this.started.get(parsed.runId);
    if (previous) return previous;
    // Callbacks are checked against CLAUDE_EXECUTOR_REF, which only holds for the platform
    // repo dispatched on `main`; anything else would have every callback refused.
    const repo = await this.host.getRepo(parsed.projectRef);
    if (repo && (repo.fullName.toLowerCase() !== PLATFORM_REPO || repo.defaultBranch !== "main")) {
      throw new Error(
        `agent runs work only on ${PLATFORM_REPO} (default branch main) until M5: Multi-project in parallel`,
      );
    }
    const dispatch = await this.host.dispatchWorkflow(
      parsed.projectRef,
      this.options.workflow ?? AGENT_RUN_WORKFLOW,
      { run_id: parsed.runId, credential: CREDENTIAL_INPUT[parsed.billingType] },
    );
    if (!dispatch)
      throw new Error(`GitHub isn't connected or the App isn't installed on ${parsed.projectRef}`);
    const handle: RunHandle = {
      runId: parsed.runId,
      externalId: dispatch.id,
      url: dispatch.url,
      executor: {
        repo: parsed.projectRef,
        ref: this.options.executorRef ?? CLAUDE_EXECUTOR_REF,
        externalId: dispatch.id,
      },
    };
    this.started.set(parsed.runId, handle);
    return handle;
  }

  async status(handle: RunHandle): Promise<RunReport> {
    const repo = handle.executor?.repo;
    const run = repo ? await this.host.getWorkflowRun(repo, handle.externalId) : null;
    return {
      runId: handle.runId,
      status: run ? toRunStatus(run) : "failed",
      summary: run ? null : "the workflow run was not found",
      pullRequestUrl: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      costIsEstimate: false,
    };
  }

  async cancel(handle: RunHandle): Promise<void> {
    if (handle.executor) await this.host.cancelWorkflowRun(handle.executor.repo, handle.externalId);
  }
}

function toRunStatus(run: WorkflowRun): RunStatus {
  if (run.status === "queued") return "queued";
  if (run.status === "in_progress") return "running";
  if (run.conclusion === "success") return "succeeded";
  if (run.conclusion === "cancelled") return "cancelled";
  return "failed";
}
