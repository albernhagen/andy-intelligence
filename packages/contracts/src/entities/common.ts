import { z } from "zod";

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/**
 * A question's id as callers send it (URL path, MCP tool input). Two forms exist: a UUID for
 * questions Andy or the system asked, and `<runId>-q<n>` for questions an agent run asked
 * (`runQuestionId`). Letters, digits and `-` only, so it is safe in a storage path (no `/`, no
 * `.`, and never Firestore's reserved `__name__` form); capped.
 */
export const QuestionId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid question id");
export type QuestionId = z.infer<typeof QuestionId>;

export const Timestamp = z.iso.datetime({ offset: true });

/**
 * Workflow stages (ARCHITECTURE §4.1). Needs-you is a flag, not a stage. Done and Cancelled are
 * terminal; only Andy cancels, and a cancelled ticket reopens to Backlog. No stage between Ready
 * for review and Done until M6: Dev → prod releases adds one (ADR-0069).
 */
export const Stage = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "ready_for_review",
  "done",
  "cancelled",
]);
export type Stage = z.infer<typeof Stage>;

/**
 * ADR-0058: Ticket model. Type changes readiness, refine and build; an epic never runs. A spike
 * (AI-99) answers a question in a findings doc under `docs/`: no product code.
 */
export const TicketType = z.enum(["epic", "feature", "chore", "bug", "spike"]);
export type TicketType = z.infer<typeof TicketType>;

export const Size = z.enum(["S", "M", "L"]);
export type Size = z.infer<typeof Size>;

export const TierKey = z.enum(["frontier", "strong", "fast", "cheap"]);
export type TierKey = z.infer<typeof TierKey>;

export const ProviderKey = z.enum(["claude-sub", "google-sub", "openrouter"]);
export type ProviderKey = z.infer<typeof ProviderKey>;

export const HarnessKey = z.enum(["claude-code", "jules", "opencode", "direct"]);
export type HarnessKey = z.infer<typeof HarnessKey>;

export const RunStep = z.enum(["refine", "plan", "build", "review", "verify", "scout", "sync"]);
export type RunStep = z.infer<typeof RunStep>;

export const Urgency = z.enum(["low", "normal", "high"]);
export type Urgency = z.infer<typeof Urgency>;

export const PolicyScope = z.enum(["global", "project", "epic", "ticket"]);
export type PolicyScope = z.infer<typeof PolicyScope>;

export const Actor = z.enum(["andy", "ui", "agent", "scout"]);
export type Actor = z.infer<typeof Actor>;

/** A (harness, provider, model) triple — one entry in a tier's ordered route list. */
export const Route = z.object({
  harness: HarnessKey,
  provider: ProviderKey,
  model: z.string().min(1),
});
export type Route = z.infer<typeof Route>;
