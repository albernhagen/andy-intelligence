import { z } from "zod";
import {
  DorStatus,
  EventActor,
  Id,
  Project,
  ProviderKey,
  Question,
  QuestionStatus,
  QuotaReading,
  Route,
  RunStatus,
  RunStep,
  Stage,
  Ticket,
  Timestamp,
  Urgency,
  type AnsweredVia,
  type TicketEvent,
} from "../entities";

/**
 * Ports (ARCHITECTURE §6). Adapters implement these; the domain only sees these types.
 * WorkTracker, Executor and QuotaSource have fakes + contract suites (see ../testing).
 * The rest are plain interfaces until a second adapter exists (ADR-0012).
 */

// ── WorkTracker ──────────────────────────────────────────────────────────────
// System of record for work (ADR-0016): projects, tickets, their history and questions.
// Storage only: stage rules and the Definition of Ready live in @andy/domain. Every write
// appends its TicketEvent in the same atomic step, so history can't miss a change.

/** A failed precondition the caller can act on; the API maps these to HTTP statuses. */
export class WorkTrackerError extends Error {
  constructor(
    readonly code: "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "WorkTrackerError";
  }
}

export const NewProject = Project.pick({ name: true, key: true }).extend({
  repos: Project.shape.repos.default([]),
  autonomy: Project.shape.autonomy.default("gated"),
});
export type NewProject = z.input<typeof NewProject>;

export const NewTicket = Ticket.pick({ type: true, title: true }).extend({
  body: z.string().default(""),
  parentId: Id.nullable().default(null),
  acceptanceCriteria: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  size: Ticket.shape.size.default(null),
  sizeReason: Ticket.shape.sizeReason.default(null),
  tier: Ticket.shape.tier.default(null),
  blockedBy: z.array(Id).default([]),
  needsYou: z.boolean().default(false),
  dorStatus: DorStatus.default("not_met"),
});
export type NewTicket = z.input<typeof NewTicket>;

/** Fields a caller may edit directly. Stage moves go through `stage` so they get their own event. */
export const TicketFields = Ticket.pick({
  title: true,
  body: true,
  parentId: true,
  acceptanceCriteria: true,
  assumptions: true,
  size: true,
  sizeReason: true,
  tier: true,
  overrides: true,
  needsYou: true,
  dorStatus: true,
  blockedBy: true,
  rank: true,
}).partial();
export type TicketFields = z.infer<typeof TicketFields>;

export const TicketChange = z.object({
  fields: TicketFields.default({}),
  stage: z
    .object({ to: Stage, forced: z.boolean().default(false), reason: z.string().nullable() })
    .optional(),
  /** Optimistic concurrency: reject with `conflict` if the ticket changed since this read. */
  ifUpdatedAt: Timestamp.optional(),
});
export type TicketChange = z.input<typeof TicketChange>;

export const NewQuestion = Question.pick({ text: true }).extend({
  options: z.array(z.string()).default([]),
  suggestedAnswer: z.string().nullable().default(null),
  assumptions: z.array(z.string()).default([]),
  urgency: Question.shape.urgency.default("normal"),
});
export type NewQuestion = z.input<typeof NewQuestion>;

export const QuestionFilter = z.object({
  projectId: Id.optional(),
  ticketId: Id.optional(),
  status: QuestionStatus.optional(),
});
export type QuestionFilter = z.infer<typeof QuestionFilter>;

export const TicketFilter = z.object({ stage: Stage.optional(), needsYou: z.boolean().optional() });
export type TicketFilter = z.infer<typeof TicketFilter>;

export interface WorkTracker {
  /** Project id is the lowercased key; a duplicate key is a `conflict`. */
  createProject(input: NewProject): Promise<Project>;
  getProject(projectId: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;

  /** Allocates the next key (e.g. "AI-7") and appends a `created` event. */
  createTicket(projectId: string, input: NewTicket, actor: EventActor): Promise<Ticket>;
  getTicket(projectId: string, ticketId: string): Promise<Ticket | null>;
  /** Sorted by rank. */
  listTickets(projectId: string, filter?: TicketFilter): Promise<Ticket[]>;
  /** Appends `fields_changed` (only fields that differ) and/or `stage_changed`. */
  updateTicket(
    projectId: string,
    ticketId: string,
    change: TicketChange,
    actor: EventActor,
  ): Promise<Ticket>;
  addComment(
    projectId: string,
    ticketId: string,
    body: string,
    actor: EventActor,
  ): Promise<TicketEvent>;
  /** Oldest first. */
  listEvents(projectId: string, ticketId: string): Promise<TicketEvent[]>;

  /** Appends `question_asked` to the ticket. */
  askQuestion(
    projectId: string,
    ticketId: string,
    input: NewQuestion,
    actor: EventActor,
  ): Promise<Question>;
  /** Only open questions can be answered (`conflict` otherwise); appends `question_answered`. */
  answerQuestion(
    questionId: string,
    answer: string,
    via: AnsweredVia,
    actor: EventActor,
  ): Promise<Question>;
  getQuestion(questionId: string): Promise<Question | null>;
  /** Oldest first. */
  listQuestions(filter?: QuestionFilter): Promise<Question[]>;
}

// ── Executor (DRAFT — do not freeze until two adapters pass; ADR-0006) ───────

export const RunRequest = z.object({
  runId: z.string().min(1),
  projectRef: z.string().min(1),
  ticketRef: z.string().nullable(),
  step: RunStep,
  route: Route,
  instructions: z.string().min(1),
  callbackUrl: z.url().nullable(),
});
export type RunRequest = z.infer<typeof RunRequest>;

export const RunHandle = z.object({
  runId: z.string().min(1),
  externalId: z.string().min(1),
  url: z.url().nullable(),
});
export type RunHandle = z.infer<typeof RunHandle>;

export const RunReport = z.object({
  runId: z.string().min(1),
  status: RunStatus,
  summary: z.string().nullable(),
  pullRequestUrl: z.url().nullable(),
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  costIsEstimate: z.boolean(),
});
export type RunReport = z.infer<typeof RunReport>;

export interface Executor {
  start(req: RunRequest): Promise<RunHandle>;
  status(handle: RunHandle): Promise<RunReport>;
  cancel(handle: RunHandle): Promise<void>;
}

// ── QuotaSource ──────────────────────────────────────────────────────────────

export interface QuotaSource {
  /** Latest reading per window for the provider; empty when unknown. */
  latest(provider: ProviderKey): Promise<QuotaReading[]>;
}

// ── Plain interfaces (no contract suite yet) ─────────────────────────────────

export interface Completion {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ModelGateway {
  complete(model: string, prompt: string, opts?: { maxTokens?: number }): Promise<Completion>;
}

export interface Notice {
  title: string;
  body: string;
  urgency: z.infer<typeof Urgency>;
  link?: string;
}

export interface Notifier {
  notify(notice: Notice): Promise<void>;
}

export interface Deployer {
  promote(projectRef: string, imageDigest: string): Promise<{ releaseRef: string }>;
  rollback(projectRef: string, releaseRef: string): Promise<void>;
}

export interface Evaluator {
  score(suite: string, model: string): Promise<{ score: number; details?: unknown }>;
}

export interface CostEvent {
  runId: string;
  provider: z.infer<typeof ProviderKey>;
  costUsd: number;
  isEstimate: boolean;
}

export interface Telemetry {
  recordCost(event: CostEvent): void;
}
