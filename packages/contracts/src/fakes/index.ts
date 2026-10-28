import type { ProviderKey, QuotaReading, Stage } from "../entities";
import {
  NewWorkItem,
  RunRequest,
  type Executor,
  type QuotaSource,
  type RunHandle,
  type RunReport,
  type WorkItem,
  type WorkTracker,
} from "../ports";

export class InMemoryWorkTracker implements WorkTracker {
  readonly items = new Map<string, WorkItem>();
  readonly comments = new Map<string, string[]>();
  private seq = 0;
  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(input: NewWorkItem): Promise<WorkItem> {
    const parsed = NewWorkItem.parse(input);
    const item: WorkItem = {
      ...parsed,
      ref: `${parsed.projectRef}#${++this.seq}`,
      stage: "backlog",
      blockedBy: [],
      updatedAt: this.now().toISOString(),
    };
    this.items.set(item.ref, item);
    return structuredClone(item);
  }

  async get(ref: string): Promise<WorkItem | null> {
    const item = this.items.get(ref);
    return item ? structuredClone(item) : null;
  }

  async list(projectRef: string, since?: string): Promise<WorkItem[]> {
    return [...this.items.values()]
      .filter((i) => i.projectRef === projectRef)
      .filter((i) => !since || i.updatedAt >= since)
      .map((i) => structuredClone(i));
  }

  async setStage(ref: string, stage: Stage): Promise<void> {
    const item = this.require(ref);
    item.stage = stage;
    item.updatedAt = this.now().toISOString();
  }

  async comment(ref: string, body: string): Promise<void> {
    this.require(ref);
    this.comments.set(ref, [...(this.comments.get(ref) ?? []), body]);
  }

  private require(ref: string): WorkItem {
    const item = this.items.get(ref);
    if (!item) throw new Error(`work item not found: ${ref}`);
    return item;
  }
}

/** Fake executor: runs complete on the next status() call unless scripted otherwise. */
export class InMemoryExecutor implements Executor {
  readonly started = new Map<string, RunRequest>();
  readonly reports = new Map<string, RunReport>();

  async start(req: RunRequest): Promise<RunHandle> {
    const parsed = RunRequest.parse(req);
    if (this.started.has(parsed.runId)) {
      // Idempotent by runId: a retried dispatch must not start a second run.
      return this.handleFor(parsed.runId);
    }
    this.started.set(parsed.runId, parsed);
    this.reports.set(parsed.runId, {
      runId: parsed.runId,
      status: "running",
      summary: null,
      pullRequestUrl: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      costIsEstimate: false,
    });
    return this.handleFor(parsed.runId);
  }

  async status(handle: RunHandle): Promise<RunReport> {
    const report = this.reports.get(handle.runId);
    if (!report) throw new Error(`unknown run: ${handle.runId}`);
    return structuredClone(report);
  }

  async cancel(handle: RunHandle): Promise<void> {
    const report = this.reports.get(handle.runId);
    if (!report) throw new Error(`unknown run: ${handle.runId}`);
    if (report.status === "running" || report.status === "queued") report.status = "cancelled";
  }

  /** Test helper: finish a run. */
  complete(runId: string, patch: Partial<RunReport> = {}): void {
    const report = this.reports.get(runId);
    if (!report) throw new Error(`unknown run: ${runId}`);
    Object.assign(report, { status: "succeeded", ...patch });
  }

  private handleFor(runId: string): RunHandle {
    return { runId, externalId: `fake-${runId}`, url: null };
  }
}

export class InMemoryQuotaSource implements QuotaSource {
  private readonly readings = new Map<ProviderKey, QuotaReading[]>();

  set(provider: ProviderKey, readings: QuotaReading[]): void {
    this.readings.set(provider, readings);
  }

  async latest(provider: ProviderKey): Promise<QuotaReading[]> {
    return structuredClone(this.readings.get(provider) ?? []);
  }
}
