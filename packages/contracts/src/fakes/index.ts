import {
  CodeHostConnection,
  CodeHostEvent,
  Repo,
  RepoName,
  type ChangedFile,
  type HeadCheck,
  type Listing,
  type PullRequest,
  type PullRequestCommit,
  type RepoToken,
  type RequiredCheck,
  type Run,
  type RunStatus,
  type WorkflowDispatch,
  type WorkflowRun,
  type AnsweredVia,
  type EventActor,
  type Project,
  type ProviderKey,
  type Question,
  type QuotaClear,
  type QuotaDiscard,
  type QuotaReading,
  type QuotaWindow,
  type Ticket,
  type TicketEvent,
} from "../entities";
import {
  ProjectPatch,
  PullRequestLink,
  RunRequest,
  WorkTrackerError,
  type CodeEventLog,
  type CodeHost,
  type CodeHostConnectionStore,
  EvalCapError,
  type EvalCaseResult,
  type EvalRunOptions,
  type EvalSuiteRun,
  type Evaluator,
  type Executor,
  type NewProject,
  type NewQuestion,
  type NewTicket,
  type OAuthGrant,
  type OAuthGrantStore,
  type QuestionFilter,
  type QuotaStore,
  quotaClearId,
  type RecordResult,
  type RunHandle,
  type RunPatch,
  type RunReport,
  type RunStore,
  type NewRun,
  WatchdogCheck,
  type WatchdogQueue,
  QueuedCheck,
  queuedCheckKey,
  ACTIVE_RUN_STATUSES,
  type TicketChange,
  type TicketFilter,
  type WorkTracker,
} from "../ports";
import {
  applyTicketChange,
  buildProject,
  buildQuestion,
  buildTicket,
  compareRanks,
  event,
  notFound,
} from "../ports/work-tracker-support";
import { applyRunPatch, buildRun, newestFirst } from "../ports/run-support";

/** In-memory WorkTracker. Writes are synchronous, so each one is trivially atomic. */
export class InMemoryWorkTracker implements WorkTracker {
  private readonly projects = new Map<string, Project>();
  private readonly tickets = new Map<string, Ticket>();
  private readonly events = new Map<string, TicketEvent[]>();
  private readonly questions = new Map<string, Question>();
  private readonly counters = new Map<string, number>();
  private readonly adrCounters = new Map<string, number>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  async createProject(input: NewProject): Promise<Project> {
    const project = buildProject(input);
    if (this.projects.has(project.id)) {
      throw new WorkTrackerError("conflict", `project key already used: ${project.key}`);
    }
    this.projects.set(project.id, project);
    return structuredClone(project);
  }

  async getProject(projectId: string): Promise<Project | null> {
    return clone(this.projects.get(projectId));
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].map((p) => structuredClone(p));
  }

  async updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
    const project = this.projects.get(projectId);
    if (!project) throw notFound("project", projectId);
    const updated = { ...project, ...ProjectPatch.parse(patch) };
    this.projects.set(projectId, updated);
    return structuredClone(updated);
  }

  async reserveAdrNumber(projectId: string, atLeast: number): Promise<number> {
    if (!this.projects.has(projectId)) throw notFound("project", projectId);
    const next = Math.max(atLeast, this.adrCounters.get(projectId) ?? 0) + 1;
    this.adrCounters.set(projectId, next);
    return next;
  }

  async createTicket(projectId: string, input: NewTicket, actor: EventActor): Promise<Ticket> {
    const project = this.projects.get(projectId);
    if (!project) throw notFound("project", projectId);
    const number = (this.counters.get(projectId) ?? 0) + 1;
    const { ticket, events } = buildTicket(project, number, input, actor, this.now());
    this.counters.set(projectId, number);
    this.tickets.set(ticket.id, ticket);
    this.events.set(ticket.id, events);
    return structuredClone(ticket);
  }

  async getTicket(projectId: string, ticketId: string): Promise<Ticket | null> {
    const ticket = this.tickets.get(ticketId);
    return ticket?.projectId === projectId ? structuredClone(ticket) : null;
  }

  async listTickets(projectId: string, filter: TicketFilter = {}): Promise<Ticket[]> {
    return [...this.tickets.values()]
      .filter((t) => t.projectId === projectId)
      .filter((t) => filter.stage === undefined || t.stage === filter.stage)
      .filter(
        (t) => filter.needsAttention === undefined || t.needsAttention === filter.needsAttention,
      )
      .filter((t) => filter.archived === undefined || t.archived === filter.archived)
      .sort((a, b) => compareRanks(a.rank, b.rank))
      .map((t) => structuredClone(t));
  }

  async updateTicket(
    projectId: string,
    ticketId: string,
    change: TicketChange,
    actor: EventActor,
  ): Promise<Ticket> {
    const current = this.requireTicket(projectId, ticketId);
    const { ticket, events } = applyTicketChange(current, change, actor, this.now());
    this.tickets.set(ticket.id, ticket);
    this.events.get(ticket.id)?.push(...events);
    return structuredClone(ticket);
  }

  async addComment(
    projectId: string,
    ticketId: string,
    body: string,
    actor: EventActor,
  ): Promise<TicketEvent> {
    const ticket = this.requireTicket(projectId, ticketId);
    const comment = event(ticket, "comment", actor, this.now(), body);
    this.events.get(ticket.id)?.push(comment);
    return structuredClone(comment);
  }

  async linkPullRequest(
    projectId: string,
    ticketId: string,
    link: PullRequestLink,
    actor: EventActor,
  ): Promise<TicketEvent> {
    const ticket = this.requireTicket(projectId, ticketId);
    const linked = event(ticket, "pr_linked", actor, this.now(), null, PullRequestLink.parse(link));
    this.events.get(ticket.id)?.push(linked);
    return structuredClone(linked);
  }

  async listEvents(projectId: string, ticketId: string): Promise<TicketEvent[]> {
    this.requireTicket(projectId, ticketId);
    return structuredClone(this.events.get(ticketId) ?? []);
  }

  async askQuestion(
    projectId: string,
    ticketId: string,
    input: NewQuestion,
    actor: EventActor,
  ): Promise<Question> {
    const ticket = this.requireTicket(projectId, ticketId);
    const at = this.now();
    const question = buildQuestion(ticket, input, at);
    this.questions.set(question.id, question);
    this.events
      .get(ticket.id)
      ?.push(
        event(ticket, "question_asked", actor, at, question.text, { questionId: question.id }),
      );
    return structuredClone(question);
  }

  async askQuestions(
    projectId: string,
    ticketId: string,
    inputs: NewQuestion[],
    actor: EventActor,
    runId?: string,
  ): Promise<Question[]> {
    const ticket = this.requireTicket(projectId, ticketId);
    const at = this.now();
    // Build every question before storing any, so a bad input writes nothing.
    const questions = inputs.map((input, index) =>
      buildQuestion(ticket, input, at, runId ? { runId, index } : null),
    );
    if (runId && questions.length > 0 && this.questions.has(questions[0]!.id)) {
      return [...this.questions.values()]
        .filter((q) => q.runId === runId)
        .map((q) => structuredClone(q));
    }
    for (const question of questions) {
      this.questions.set(question.id, question);
      this.events
        .get(ticket.id)
        ?.push(
          event(ticket, "question_asked", actor, at, question.text, { questionId: question.id }),
        );
    }
    return structuredClone(questions);
  }

  async answerQuestion(
    questionId: string,
    answer: string,
    via: AnsweredVia,
    actor: EventActor,
  ): Promise<Question> {
    const question = this.questions.get(questionId);
    if (!question) throw notFound("question", questionId);
    if (question.status !== "open") {
      throw new WorkTrackerError("conflict", `question is ${question.status}: ${questionId}`);
    }
    const at = this.now();
    const answered: Question = {
      ...question,
      status: "answered",
      answer,
      answeredVia: via,
      answeredAt: at.toISOString(),
    };
    this.questions.set(questionId, answered);
    const ticket = this.requireTicket(question.projectId, question.ticketId);
    this.events
      .get(ticket.id)
      ?.push(event(ticket, "question_answered", actor, at, answer, { questionId, via }));
    return structuredClone(answered);
  }

  async withdrawQuestion(questionId: string, actor: EventActor): Promise<Question> {
    const question = this.questions.get(questionId);
    if (!question) throw notFound("question", questionId);
    if (question.status !== "open") {
      throw new WorkTrackerError("conflict", `question is ${question.status}: ${questionId}`);
    }
    const withdrawn: Question = { ...question, status: "withdrawn" };
    this.questions.set(questionId, withdrawn);
    const ticket = this.requireTicket(question.projectId, question.ticketId);
    this.events
      .get(ticket.id)
      ?.push(event(ticket, "question_withdrawn", actor, this.now(), null, { questionId }));
    return structuredClone(withdrawn);
  }

  async getQuestion(questionId: string): Promise<Question | null> {
    return clone(this.questions.get(questionId));
  }

  async listQuestions(filter: QuestionFilter = {}): Promise<Question[]> {
    return [...this.questions.values()]
      .filter((q) => filter.projectId === undefined || q.projectId === filter.projectId)
      .filter((q) => filter.ticketId === undefined || q.ticketId === filter.ticketId)
      .filter((q) => filter.status === undefined || q.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((q) => structuredClone(q));
  }

  private requireTicket(projectId: string, ticketId: string): Ticket {
    const ticket = this.tickets.get(ticketId);
    if (ticket?.projectId !== projectId) throw notFound("ticket", ticketId);
    return ticket;
  }
}

const clone = <T>(value: T | undefined): T | null =>
  value === undefined ? null : structuredClone(value);

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
    return { runId, externalId: `fake-${runId}`, url: null, executor: null };
  }
}

/** In-memory RunStore. Check-and-write has no await in between, so updates are atomic. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(input: NewRun): Promise<Run> {
    const run = buildRun(input, crypto.randomUUID(), this.now());
    this.runs.set(run.id, run);
    return structuredClone(run);
  }

  async get(runId: string): Promise<Run | null> {
    return clone(this.runs.get(runId));
  }

  async listForTicket(projectId: string, ticketId: string): Promise<Run[]> {
    return [...this.runs.values()]
      .filter((r) => r.projectId === projectId && r.ticketId === ticketId)
      .sort(newestFirst)
      .map((r) => structuredClone(r));
  }

  async listActive(projectId: string): Promise<Run[]> {
    return [...this.runs.values()]
      .filter((r) => r.projectId === projectId && ACTIVE_RUN_STATUSES.includes(r.status))
      .sort(newestFirst)
      .map((r) => structuredClone(r));
  }

  async listEndedBetween(projectId: string, from: string, to: string, limit: number) {
    const within = (r: Run) => !!r.endedAt && r.endedAt >= from && r.endedAt <= to;
    const found = [...this.runs.values()]
      .filter((r) => r.projectId === projectId && within(r))
      .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
    return {
      runs: found.slice(0, limit).map((r) => structuredClone(r)),
      complete: found.length <= limit,
    };
  }

  async update(runId: string, patch: RunPatch, from: readonly RunStatus[]): Promise<Run> {
    const current = this.runs.get(runId);
    if (!current) throw notFound("run", runId);
    const run = applyRunPatch(current, patch, from);
    this.runs.set(runId, run);
    return structuredClone(run);
  }
}

/** In-memory WatchdogQueue: holds checks until a test delivers them with `due`. */
export class InMemoryWatchdogQueue implements WatchdogQueue {
  readonly checks = new Map<string, WatchdogCheck>();

  async schedule(check: WatchdogCheck): Promise<"scheduled" | "duplicate"> {
    const parsed = WatchdogCheck.parse(check);
    if (this.checks.has(parsed.runId)) return "duplicate";
    this.checks.set(parsed.runId, parsed);
    return "scheduled";
  }

  /** Lease and runner-away checks, by their key. */
  readonly queued = new Map<string, QueuedCheck>();

  async scheduleCheck(check: QueuedCheck): Promise<"scheduled" | "duplicate"> {
    const parsed = QueuedCheck.parse(check);
    const key = queuedCheckKey(parsed);
    if (this.queued.has(key)) return "duplicate";
    this.queued.set(key, parsed);
    return "scheduled";
  }

  /** Test helper: queued checks due at `now`, earliest first; delivered ones are removed. */
  takeDue(now: Date): QueuedCheck[] {
    const due = [...this.queued.entries()]
      .filter(([, c]) => Date.parse(c.at) <= now.getTime())
      .sort(([, a], [, b]) => a.at.localeCompare(b.at));
    for (const [key] of due) this.queued.delete(key);
    return due.map(([, c]) => c);
  }

  /** Test helper: run IDs whose check is due at `now`, earliest first. */
  due(now: Date): string[] {
    return [...this.checks.values()]
      .filter((c) => Date.parse(c.at) <= now.getTime())
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((c) => c.runId);
  }
}

export class InMemoryQuotaStore implements QuotaStore {
  private readonly readings = new Map<string, QuotaReading>();
  private readonly clears = new Map<string, QuotaClear>();

  async save(readings: QuotaReading[]): Promise<void> {
    for (const r of readings) this.readings.set(`${r.provider}_${r.window}`, structuredClone(r));
  }

  async latest(provider: ProviderKey): Promise<QuotaReading[]> {
    return structuredClone([...this.readings.values()].filter((r) => r.provider === provider));
  }

  async discard(
    provider: ProviderKey,
    readings: { window: QuotaWindow; takenAt: string }[],
    by: QuotaDiscard,
  ): Promise<QuotaClear[]> {
    const made: QuotaClear[] = [];
    for (const { window, takenAt } of readings) {
      const stored = this.readings.get(`${provider}_${window}`);
      const id = quotaClearId(provider, window, takenAt);
      if (!stored || stored.takenAt !== takenAt || stored.discarded || this.clears.has(id)) {
        continue;
      }
      stored.discarded = { ...by };
      const clear: QuotaClear = {
        id,
        provider,
        window,
        usedPct: stored.usedPct,
        readingTakenAt: takenAt,
        by: by.by,
        at: by.at,
      };
      this.clears.set(id, clear);
      made.push(structuredClone(clear));
    }
    return made;
  }

  async clearsSince(provider: ProviderKey, since: string, limit: number): Promise<QuotaClear[]> {
    return structuredClone(
      [...this.clears.values()]
        .filter((c) => c.provider === provider && c.at >= since)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    );
  }
}

/** In-memory OAuthGrantStore. Expired grants read as missing, like the real store. */
export class InMemoryOAuthGrantStore implements OAuthGrantStore {
  private readonly grants = new Map<string, OAuthGrant>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async put(key: string, grant: OAuthGrant): Promise<void> {
    this.grants.set(key, structuredClone(grant));
  }

  async get(key: string): Promise<OAuthGrant | null> {
    return this.live(key);
  }

  async take(key: string): Promise<OAuthGrant | null> {
    // Read and delete without an await in between, so concurrent takes can't both win.
    const grant = this.live(key);
    this.grants.delete(key);
    return grant;
  }

  private live(key: string): OAuthGrant | null {
    const grant = this.grants.get(key);
    if (!grant || Date.parse(grant.expiresAt) <= this.now().getTime()) return null;
    return structuredClone(grant);
  }
}

/** In-memory CodeHost: repos count as installed once added with `install`. */
export class InMemoryCodeHost implements CodeHost {
  private readonly repos = new Map<string, Repo>();
  /** Workflow runs started with `dispatchWorkflow`, by run ID. */
  readonly workflowRuns = new Map<
    string,
    { repo: string; workflow: string; inputs: Record<string, string>; run: WorkflowRun }
  >();
  /** Test seam: make the next dispatches fail. */
  failDispatch: Error | null = null;
  /** Test seam: pull requests and what the host knows about them, by number. */
  readonly pullRequests = new Map<number, FakePullRequest>();
  requiredChecks: RequiredCheck[] = [];
  /** Test seam: file text by path (any ref). */
  readonly files = new Map<string, string>();
  /** Merge calls that went through, in order. */
  readonly merges: { fullName: string; number: number; sha: string }[] = [];
  /** Test seam: make merge calls fail. */
  failMerge: Error | null = null;
  /** Test seam: head commits that don't contain the default branch yet (others do). */
  readonly behindDefault = new Set<string>();

  constructor(
    repos: Repo[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {
    repos.forEach((r) => this.install(r));
  }

  install(repo: Repo): void {
    this.repos.set(repo.fullName.toLowerCase(), Repo.parse(repo));
  }

  uninstall(fullName: string): void {
    this.repos.delete(fullName.toLowerCase());
  }

  async getRepo(fullName: string): Promise<Repo | null> {
    if (!RepoName.safeParse(fullName).success) return null;
    const repo = this.repos.get(fullName.toLowerCase());
    return repo ? structuredClone(repo) : null;
  }

  async listInstalledRepos(): Promise<Repo[]> {
    return [...this.repos.values()]
      .map((r) => structuredClone(r))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async issueRepoToken(fullName: string): Promise<RepoToken | null> {
    const repo = await this.getRepo(fullName);
    if (!repo) return null;
    return {
      token: `fake-token-${repo.fullName}`,
      expiresAt: new Date(this.now().getTime() + 60 * 60 * 1000).toISOString(),
      actor: "fake-app[bot]",
    };
  }

  async dispatchWorkflow(
    fullName: string,
    workflow: string,
    inputs: Record<string, string>,
  ): Promise<WorkflowDispatch | null> {
    const repo = await this.getRepo(fullName);
    if (!repo) return null;
    if (this.failDispatch) throw this.failDispatch;
    const id = String(this.workflowRuns.size + 1);
    const url = `${repo.url}/actions/runs/${id}`;
    this.workflowRuns.set(id, {
      repo: repo.fullName,
      workflow,
      inputs: { ...inputs },
      run: {
        id,
        name: workflow,
        trigger: "workflow_dispatch",
        status: "queued",
        conclusion: null,
        headBranch: repo.defaultBranch,
        headSha: "0000000",
        url,
      },
    });
    return { id, url };
  }

  async getWorkflowRun(fullName: string, runId: string): Promise<WorkflowRun | null> {
    const entry = this.workflowRuns.get(runId);
    if (!entry || entry.repo.toLowerCase() !== fullName.toLowerCase()) return null;
    return structuredClone(entry.run);
  }

  async cancelWorkflowRun(fullName: string, runId: string): Promise<void> {
    const run = await this.getWorkflowRun(fullName, runId);
    if (!run || run.status === "completed") return;
    this.workflowRuns.get(runId)!.run = { ...run, status: "completed", conclusion: "cancelled" };
  }

  async getPullRequest(fullName: string, number: number): Promise<PullRequest | null> {
    if (!(await this.getRepo(fullName))) return null;
    const pr = this.pullRequests.get(number);
    return pr ? structuredClone(pr.pullRequest) : null;
  }

  async listChangedFiles(_fullName: string, number: number): Promise<Listing<ChangedFile>> {
    return structuredClone(this.pullRequests.get(number)?.files ?? { items: [], complete: true });
  }

  async listHeadChecks(_fullName: string, sha: string): Promise<Listing<HeadCheck>> {
    const pr = [...this.pullRequests.values()].find((p) => p.pullRequest.headSha === sha);
    return structuredClone(pr?.checks ?? { items: [], complete: true });
  }

  async listRequiredChecks(fullName: string): Promise<RequiredCheck[]> {
    return (await this.getRepo(fullName)) ? structuredClone(this.requiredChecks) : [];
  }

  async listPullRequestCommits(
    _fullName: string,
    number: number,
  ): Promise<Listing<PullRequestCommit>> {
    return structuredClone(this.pullRequests.get(number)?.commits ?? { items: [], complete: true });
  }

  async readFile(fullName: string, path: string): Promise<string | null> {
    if (!(await this.getRepo(fullName))) return null;
    return this.files.get(path) ?? null;
  }

  async mergePullRequest(fullName: string, number: number, expectedHeadSha: string): Promise<void> {
    if (this.failMerge) throw this.failMerge;
    const pr = this.pullRequests.get(number);
    if (!pr || pr.pullRequest.state !== "open") throw new Error("not mergeable");
    if (pr.pullRequest.headSha !== expectedHeadSha) throw new Error("head moved");
    pr.pullRequest.state = "merged";
    this.merges.push({ fullName, number, sha: expectedHeadSha });
  }

  async headContains(fullName: string, head: string): Promise<boolean | null> {
    if (!(await this.getRepo(fullName))) return null;
    return !this.behindDefault.has(head);
  }
}

export interface FakePullRequest {
  pullRequest: PullRequest;
  files: Listing<ChangedFile>;
  checks: Listing<HeadCheck>;
  commits: Listing<PullRequestCommit>;
}

/** In-memory CodeHostConnectionStore. */
export class InMemoryCodeHostConnectionStore implements CodeHostConnectionStore {
  private connection: CodeHostConnection | null = null;

  async get(): Promise<CodeHostConnection | null> {
    return this.connection ? structuredClone(this.connection) : null;
  }

  async save(connection: CodeHostConnection): Promise<"saved" | "exists"> {
    if (this.connection) return "exists";
    this.connection = CodeHostConnection.parse(connection);
    return "saved";
  }
}

/** In-memory CodeEventLog. The check and the write have no await between them: atomic. */
export class InMemoryCodeEventLog implements CodeEventLog {
  private readonly events = new Map<string, CodeHostEvent>();

  async record(event: CodeHostEvent): Promise<RecordResult> {
    const parsed = CodeHostEvent.parse(event);
    if (this.events.has(parsed.deliveryId)) return "duplicate";
    this.events.set(parsed.deliveryId, parsed);
    return "recorded";
  }

  async get(deliveryId: string): Promise<CodeHostEvent | null> {
    const event = this.events.get(deliveryId);
    return event ? structuredClone(event) : null;
  }
}

/** Fake evaluator: each case returns its scripted outcome; an unscripted case is an error. */
export class InMemoryEvaluator implements Evaluator {
  readonly runs: { suite: string; caseIds: string[] }[] = [];

  constructor(private readonly scripted: Record<string, Omit<EvalCaseResult, "caseId">> = {}) {}

  async score(): Promise<{ score: number }> {
    return { score: 0 };
  }

  async runSuite(suite: string, options: EvalRunOptions): Promise<EvalSuiteRun> {
    if (options.caseIds.length > options.maxCases) {
      throw new EvalCapError(`${options.caseIds.length} cases over the cap of ${options.maxCases}`);
    }
    this.runs.push({ suite, caseIds: [...options.caseIds] });
    return {
      suite,
      cases: options.caseIds.map((caseId) => {
        const s = this.scripted[caseId];
        return s
          ? { caseId, ...structuredClone(s) }
          : {
              caseId,
              status: "error",
              passed: false,
              inputTokens: null,
              failures: ["unknown case"],
            };
      }),
    };
  }
}
export * from "./notify-email";
export * from "./runner";
export * from "./config-proposals";
