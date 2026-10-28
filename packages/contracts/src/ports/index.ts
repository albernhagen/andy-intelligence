import { z } from "zod";
import {
  ProviderKey,
  QuotaReading,
  Route,
  RunStatus,
  RunStep,
  Stage,
  TicketType,
  Urgency,
} from "../entities";

/**
 * Ports (ARCHITECTURE §6). Adapters implement these; the domain only sees these types.
 * WorkTracker, Executor and QuotaSource have fakes + contract suites (see ../testing).
 * The rest are plain interfaces until a second adapter exists (ADR-0012).
 */

// ── WorkTracker ──────────────────────────────────────────────────────────────

export const WorkItem = z.object({
  ref: z.string().min(1),
  projectRef: z.string().min(1),
  type: TicketType,
  title: z.string().min(1),
  body: z.string(),
  stage: Stage,
  parentRef: z.string().nullable(),
  blockedBy: z.array(z.string()),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type WorkItem = z.infer<typeof WorkItem>;

export const NewWorkItem = WorkItem.pick({
  projectRef: true,
  type: true,
  title: true,
  body: true,
}).extend({ parentRef: z.string().nullable().default(null) });
export type NewWorkItem = z.input<typeof NewWorkItem>;

export interface WorkTracker {
  create(item: NewWorkItem): Promise<WorkItem>;
  get(ref: string): Promise<WorkItem | null>;
  /** Items changed since `since` (ISO), or all items when omitted. Used by the run watchdog and UI refresh. */
  list(projectRef: string, since?: string): Promise<WorkItem[]>;
  setStage(ref: string, stage: Stage): Promise<void>;
  comment(ref: string, body: string): Promise<void>;
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
