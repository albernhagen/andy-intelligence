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
