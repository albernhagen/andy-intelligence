import type { EventActor, Stage, Ticket, TicketChange, WorkTracker } from "@andy/contracts";
import { WorkTrackerError } from "@andy/contracts";

/**
 * An epic's stage follows its tickets (ADR-0164, AI-404). The stage stays stored, so every reader
 * (board, roadmap, milestone page, MCP `status` and `milestone_map`, digest, dispatch holds, epic
 * merge mode) reads one value; `syncEpicStages` keeps it in step on every ticket write.
 */

/** How far up a chain of epics one write syncs (ADR-0131 nests one level; this bounds a cycle). */
export const EPIC_SYNC_MAX_DEPTH = 5;

/** The fields whose change can change a parent epic's stage. */
const SYNC_FIELDS = ["parentId", "archived", "type", "needsCheck"] as const;

/** "Why" for the epic's stage event: what its tickets say. */
export function epicStageReason(children: readonly Pick<Ticket, "stage">[]): string {
  const counted = children.filter((c) => c.stage !== "cancelled");
  const done = counted.filter((c) => c.stage === "done").length;
  return `follows its tickets: ${done} of ${counted.length} done`;
}

/**
 * The stage an epic's children give it. Cancelled children don't count; archived ones do (only
 * Done or Cancelled tickets are archived). None left → Backlog (not started); all Done → Done, or
 * Ready for review ("Waiting for your check") when `needsCheck` is on and the owner hasn't closed
 * it yet; any past Backlog → In progress; else Backlog. A child epic counts by its own stage, so
 * nesting rolls up one level at a time.
 */
export function epicStage(
  epic: Pick<Ticket, "stage" | "needsCheck">,
  children: readonly Pick<Ticket, "stage">[],
): Stage {
  const counted = children.filter((c) => c.stage !== "cancelled");
  if (counted.length === 0) return "backlog";
  if (counted.every((c) => c.stage === "done")) {
    if (!epic.needsCheck || epic.stage === "done") return "done";
    return "ready_for_review";
  }
  return counted.some((c) => c.stage !== "backlog") ? "in_progress" : "backlog";
}

/** The three states screens name; Ready for review on an epic means waiting for the owner's check. */
export type EpicState = "not_started" | "in_progress" | "waiting_for_check" | "done";

export function epicStateOf(stage: Stage): EpicState {
  if (stage === "done") return "done";
  if (stage === "ready_for_review") return "waiting_for_check";
  return stage === "backlog" || stage === "cancelled" ? "not_started" : "in_progress";
}

const log = (severity: "INFO" | "ERROR", message: string, fields: object = {}) =>
  console.log(JSON.stringify({ severity, message, component: "epic-state", ...fields }));

/**
 * Sets one epic's stage to what its children give it, as `system`. Returns the epic after the
 * write, or null when nothing was written (not an epic, Cancelled, already in step). Leaving Done
 * unarchives it, as `TicketService.move` does. Reads: the epic and its children (one query).
 */
export async function syncEpicStage(
  tracker: WorkTracker,
  projectId: string,
  epicId: string,
): Promise<Ticket | null> {
  const epic = await tracker.getTicket(projectId, epicId);
  if (!epic || epic.type !== "epic" || epic.stage === "cancelled") return null;
  const children = await tracker.listTickets(projectId, { parentId: epic.id });
  const to = epicStage(epic, children);
  if (to === epic.stage) return null;
  const leavesDone = epic.archived && to !== "done";
  const updated = await tracker.updateTicket(
    projectId,
    epic.id,
    {
      fields: leavesDone ? { archived: false } : {},
      stage: { to, forced: false, reason: epicStageReason(children) },
      ifUpdatedAt: epic.updatedAt,
    },
    "system",
  );
  log("INFO", "epic stage follows its tickets", { epic: epic.key, from: epic.stage, to });
  return updated;
}

/** Syncs an epic, then each epic above it whose child just changed stage. One retry on conflict. */
async function syncUp(tracker: WorkTracker, projectId: string, epicId: string): Promise<void> {
  let next: string | null = epicId;
  for (let depth = 0; next && depth < EPIC_SYNC_MAX_DEPTH; depth++) {
    let synced: Ticket | null;
    try {
      synced = await syncEpicStage(tracker, projectId, next);
    } catch (err) {
      if (!(err instanceof WorkTrackerError && err.code === "conflict")) throw err;
      synced = await syncEpicStage(tracker, projectId, next);
    }
    next = synced?.parentId ?? null;
  }
}

/** Whether a write can change the stage of its parent epic, or of the ticket as an epic. */
function touchesSync(change: TicketChange): boolean {
  return change.stage !== undefined || SYNC_FIELDS.some((f) => change.fields?.[f] !== undefined);
}

/**
 * The WorkTracker with every ticket write keeping epic stages in step (ADR-0164), as
 * `notifyOnNeedsYou` and `bumpOnWrite` wrap it. A write that changes a ticket's stage, parent,
 * archived flag, type or `needsCheck` syncs its parent epic (and its old parent on a reparent,
 * read before the write), the ticket itself when it is an epic (so a stray stage write, e.g. a
 * reopen, is put back in step at once), and up the chain. The sync's own writes go to the inner
 * tracker, so they never loop. A sync failure is logged and never fails the write: the next write or the fix-up
 * (`epic-state-fixup.ts`) heals it.
 */
export function syncEpicStages(tracker: WorkTracker): WorkTracker {
  const sync = async (projectId: string, epicIds: readonly (string | null)[], key: string) => {
    for (const id of new Set(epicIds.filter((x): x is string => x !== null))) {
      try {
        await syncUp(tracker, projectId, id);
      } catch (err) {
        log("ERROR", "epic stage sync failed; the next ticket write or the fix-up heals it", {
          ticket: key,
          epicId: id,
          error: String(err),
        });
      }
    }
  };
  const createTicket: WorkTracker["createTicket"] = async (projectId, input, actor) => {
    const created = await tracker.createTicket(projectId, input, actor);
    await sync(
      projectId,
      [created.parentId, created.type === "epic" ? created.id : null],
      created.key,
    );
    return created;
  };
  const updateTicket: WorkTracker["updateTicket"] = async (
    projectId: string,
    ticketId: string,
    change: TicketChange,
    actor: EventActor,
  ) => {
    if (!touchesSync(change)) return tracker.updateTicket(projectId, ticketId, change, actor);
    const reparents = change.fields?.parentId !== undefined;
    const before = reparents ? await tracker.getTicket(projectId, ticketId) : null;
    const after = await tracker.updateTicket(projectId, ticketId, change, actor);
    // Any other write to an epic's stage, type or flag is put back in step with its tickets.
    const self = after.type === "epic" ? after.id : null;
    await sync(projectId, [after.parentId, before?.parentId ?? null, self], after.key);
    // An epic may have been put back in step just now: callers see the stage it ended with.
    return self ? ((await tracker.getTicket(projectId, self)) ?? after) : after;
  };
  return new Proxy(tracker, {
    get(target, prop, receiver) {
      if (prop === "createTicket") return createTicket;
      if (prop === "updateTicket") return updateTicket;
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** One epic the fix-up would move: from its stored stage to the one its tickets give it. */
export interface EpicStageFix {
  id: string;
  key: string;
  title: string;
  from: Stage;
  to: Stage;
  reason: string;
}

/**
 * The epics whose stored stage differs from what their tickets give them (ADR-0164 fix-up), in
 * the order to write them: child epics before their parents. Pure: computed in memory over the
 * project's tickets, re-run up to `EPIC_SYNC_MAX_DEPTH` times so a moved child epic moves its
 * parent. Cancelled epics are left alone.
 */
export function epicStageFixes(tickets: readonly Ticket[]): EpicStageFix[] {
  const stages = new Map(tickets.map((t) => [t.id, t.stage]));
  const epics = tickets.filter((t) => t.type === "epic" && t.stage !== "cancelled");
  const children = (id: string) =>
    tickets.filter((t) => t.parentId === id).map((t) => ({ stage: stages.get(t.id)! }));
  const order: string[] = [];
  for (let pass = 0; pass < EPIC_SYNC_MAX_DEPTH; pass++) {
    let changed = false;
    for (const epic of epics) {
      const now = stages.get(epic.id)!;
      const to = epicStage({ stage: now, needsCheck: epic.needsCheck }, children(epic.id));
      if (to === now) continue;
      stages.set(epic.id, to);
      // Moved again in a later pass: it goes after the child epics that moved it.
      const at = order.indexOf(epic.id);
      if (at >= 0) order.splice(at, 1);
      order.push(epic.id);
      changed = true;
    }
    if (!changed) break;
  }
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return order
    .map((id) => byId.get(id)!)
    .filter((e) => stages.get(e.id) !== e.stage)
    .map((e) => ({
      id: e.id,
      key: e.key,
      title: e.title,
      from: e.stage,
      to: stages.get(e.id)!,
      reason: epicStageReason(children(e.id)),
    }));
}
