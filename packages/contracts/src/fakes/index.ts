import type {
  AnsweredVia,
  EventActor,
  Project,
  ProviderKey,
  Question,
  QuotaReading,
  Ticket,
  TicketEvent,
} from "../entities";
import {
  RunRequest,
  WorkTrackerError,
  type Executor,
  type NewProject,
  type NewQuestion,
  type NewTicket,
  type QuestionFilter,
  type QuotaSource,
  type RunHandle,
  type RunReport,
  type TicketChange,
  type TicketFilter,
  type WorkTracker,
} from "../ports";
import {
  applyTicketChange,
  buildProject,
  buildQuestion,
  buildTicket,
  event,
  notFound,
} from "../ports/work-tracker-support";

/** In-memory WorkTracker. Writes are synchronous, so each one is trivially atomic. */
export class InMemoryWorkTracker implements WorkTracker {
  private readonly projects = new Map<string, Project>();
  private readonly tickets = new Map<string, Ticket>();
  private readonly events = new Map<string, TicketEvent[]>();
  private readonly questions = new Map<string, Question>();
  private readonly counters = new Map<string, number>();
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
      .filter((t) => filter.needsYou === undefined || t.needsYou === filter.needsYou)
      .sort((a, b) => a.rank.localeCompare(b.rank))
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
