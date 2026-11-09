import type { QuotaDelta, TicketCost } from "@andy/contracts";
import { ticketCost } from "@andy/domain";
import { useRuns } from "@/lib/queries";

/** "5h +3.2%, weekly +0.4%", or null with nothing to show. */
export function formatQuotaDelta(delta: QuotaDelta): string | null {
  const parts = [
    delta["5h"] !== null ? `5h +${delta["5h"]}%` : null,
    delta.weekly !== null ? `weekly +${delta.weekly}%` : null,
  ].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function formatTicketCost(cost: TicketCost): string {
  const allUnknown = cost.unknownRuns === cost.completedRuns;
  const quota = formatQuotaDelta(cost.quotaDelta);
  return [
    allUnknown ? "Cost unknown" : `Cost ~$${cost.estimatedCostUsd.toFixed(2)} (estimate)`,
    quota && `quota ${quota}`,
    cost.unknownRuns > 0 &&
      `${cost.unknownRuns} ${cost.unknownRuns === 1 ? "run" : "runs"} unknown`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The ticket's total from the runs the panel already polls, with the API's own function, so it
 * moves when a run ends. Nothing until a run has finished.
 */
export function TicketCostLine(path: { projectId: string; ticketId: string }) {
  const runs = useRuns(path).data;
  if (!runs) return null;
  const cost = ticketCost(runs);
  if (cost.completedRuns === 0) return null;
  return (
    <p aria-label="Ticket cost" className="text-sm text-muted-foreground">
      {formatTicketCost(cost)}
    </p>
  );
}
