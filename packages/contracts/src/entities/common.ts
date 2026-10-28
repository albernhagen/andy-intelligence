import { z } from "zod";

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

export const Timestamp = z.iso.datetime({ offset: true });

/** Workflow stages (ARCHITECTURE §4.1). Needs-you is a flag, not a stage. */
export const Stage = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "ready_for_review",
  "monitoring",
  "done",
]);
export type Stage = z.infer<typeof Stage>;

export const TicketType = z.enum(["epic", "story", "task", "bug"]);
export type TicketType = z.infer<typeof TicketType>;

export const Size = z.enum(["S", "M", "L"]);
export type Size = z.infer<typeof Size>;

export const TierKey = z.enum(["frontier", "strong", "fast", "cheap"]);
export type TierKey = z.infer<typeof TierKey>;

export const ProviderKey = z.enum(["claude-sub", "google-sub", "openrouter"]);
export type ProviderKey = z.infer<typeof ProviderKey>;

export const HarnessKey = z.enum(["claude-code", "jules", "opencode", "direct"]);
export type HarnessKey = z.infer<typeof HarnessKey>;

export const RunStep = z.enum(["refine", "plan", "build", "review", "verify", "scout"]);
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
