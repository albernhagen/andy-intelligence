import type { Stage, TicketType, Worker } from "@andy/contracts";

/** The inbox's order and grouping live in `@andy/domain`, shared with the API and MCP (AI-40). */
export {
  cardCount,
  inboxCards,
  inboxItems,
  isStale,
  waitingCounts,
  withoutQuestion,
  type InboxCard,
  type NeedsYou,
} from "@andy/domain";

/**
 * What a ticket's worker means on screen (ADR-0082). Deliberately not an inbox item: these tickets
 * wait on Andy's own time, and only `needsAttention` and open questions reach the inbox.
 */
export function workerStatus(worker: Worker, stage: Stage, type: TicketType | null) {
  const open = stage !== "done" && stage !== "cancelled";
  return {
    mine: open && worker === "me",
    waiting: worker === "me" && (stage === "ready" || stage === "in_progress"),
    // An epic never runs (ADR-0058), so it never needs a worker.
    needsWorker: open && worker === "ask" && type !== "epic",
  };
}
