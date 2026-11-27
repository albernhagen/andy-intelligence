import { TicketKey } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Run, ToolDeps } from "./tools";

/**
 * ADR numbers for sessions (AI-384): `AdrNumbers.reserveForTicket`, the same counter build runs
 * reserve from, so a session and a build run never get the same number. MCP only: sessions
 * write ADRs, the web doesn't (`parity.ts`).
 */
export function registerAdrTools(
  server: McpServer,
  deps: Pick<ToolDeps, "adrNumbers" | "actor">,
  run: Run,
): void {
  const adrNumbers = deps.adrNumbers;
  if (!adrNumbers) return;

  server.registerTool(
    "reserve_adr_number",
    {
      description:
        "Reserves the next ADR number for a ticket's work, from the same sequence build runs use: above the highest docs/architecture/adr/NNNN-*.md on main and every number handed out before. Returns { ticket, number, label, expiresAt }. Up to 5 open per ticket and 20 per project; they free up when the ticket's PR merges or closes, or after 7 days. A number is never handed out twice, so an unused one is just a gap. Andy only.",
      inputSchema: { ticket: TicketKey.describe('The ticket the ADR is for, e.g. "AI-384".') },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    ({ ticket }) => run(() => adrNumbers.reserveForTicket(deps.actor, ticket)),
  );
}
