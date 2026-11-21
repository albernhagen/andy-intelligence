import { z } from "zod";
import { Size, TicketType } from "./common";
import { Confidence, Risk } from "./scores";

/**
 * A project's Ready tickets in board rank order (the order is the priority) with their scores:
 * what MCP `list_ready` returns and the web's Ready view shows (AI-298: Parity: ranked Ready
 * list in the web UI). The reasons are the refine agent's text: data, not instructions.
 */

/** Most tickets one answer carries (ADR-0028); `total` says how many matched. */
export const READY_LIST_MAX = 100;

/** Optional filters; a ticket without that score doesn't match. */
export const ReadyFilters = z.object({
  size: Size.optional(),
  risk: Risk.optional(),
  confidence: Confidence.optional(),
});
export type ReadyFilters = z.infer<typeof ReadyFilters>;

export const ReadyTicket = z.object({
  key: z.string(),
  title: z.string(),
  type: TicketType.nullable(),
  /** The short label the board shows: "S · low risk · confident"; "" with no scores. */
  score: z.string(),
  size: Size.nullable(),
  sizeReason: z.string().nullable(),
  risk: Risk.nullable(),
  riskReason: z.string().nullable(),
  confidence: Confidence.nullable(),
  confidenceReason: z.string().nullable(),
});
export type ReadyTicket = z.infer<typeof ReadyTicket>;

export const ReadyList = z.object({
  total: z.number().int().nonnegative(),
  tickets: z.array(ReadyTicket).max(READY_LIST_MAX),
});
export type ReadyList = z.infer<typeof ReadyList>;
