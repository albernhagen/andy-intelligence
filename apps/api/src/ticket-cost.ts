import { ticketCost, type RunService } from "@andy/domain";
import type { TicketCost } from "@andy/contracts";

/** The ticket's cost totals (AI-67), for its REST and MCP reads. */
export async function costOfTicket(
  runs: RunService,
  ticket: { projectId: string; id: string },
): Promise<TicketCost> {
  return ticketCost(await runs.list(ticket.projectId, ticket.id));
}
