import {
  READY_LIST_MAX,
  WorkTrackerError,
  compareRanks,
  type ReadyFilters,
  type ReadyList,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { startScore } from "./scores";

/**
 * The ranked Ready list (AI-298): one read behind MCP `list_ready` and REST
 * `GET /api/projects/:id/ready`, so both return the same tickets in the same order.
 */

const matches = (t: Ticket, f: ReadyFilters) =>
  (!f.size || t.size === f.size) &&
  (!f.risk || t.risk === f.risk) &&
  (!f.confidence || t.confidence === f.confidence);

/** Ready, unarchived tickets matching `filters`, in rank order, at most `READY_LIST_MAX`. */
export function rankReady(tickets: readonly Ticket[], filters: ReadyFilters): ReadyList {
  const found = tickets
    .filter((t) => t.stage === "ready" && !t.archived && matches(t, filters))
    .sort((a, b) => compareRanks(a.rank, b.rank));
  return {
    total: found.length,
    tickets: found.slice(0, READY_LIST_MAX).map((t) => ({
      key: t.key,
      title: t.title,
      type: t.type,
      score: startScore(t),
      size: t.size,
      sizeReason: t.sizeReason,
      risk: t.risk,
      riskReason: t.riskReason,
      confidence: t.confidence,
      confidenceReason: t.confidenceReason,
    })),
  };
}

/** The project's ranked Ready list; an unknown project is `not_found`. */
export async function readyList(
  tracker: Pick<WorkTracker, "getProject" | "listTickets">,
  projectId: string,
  filters: ReadyFilters,
): Promise<ReadyList> {
  if (!(await tracker.getProject(projectId))) {
    throw new WorkTrackerError("not_found", `project ${projectId.toUpperCase()} not found`);
  }
  return rankReady(
    await tracker.listTickets(projectId, { stage: "ready", archived: false }),
    filters,
  );
}
