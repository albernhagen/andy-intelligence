import type { Ticket, WorkTracker } from "@andy/contracts";
import { DomainError } from "./errors";
import { projectOfKey } from "./ticket-edits";

/**
 * Reads of just the tickets a rule needs, never the whole project (AI-222: Firestore reads grow
 * with project size). Each read is one ticket by key or id, or one lane by stage.
 */

/** Most tickets one blocker chain or parent chain may read before it's refused (ADR-0028). */
export const MAX_CHAIN_READS = 200;

/**
 * The ticket an entry names: a key in its own project (AI-96), or an id in `projectId` (blocker
 * entries written before AI-96, parent ids). One read; null when it names nothing.
 */
export async function ticketByRef(
  tracker: Pick<WorkTracker, "getTicket" | "getTicketByKey">,
  projectId: string,
  ref: string,
): Promise<Ticket | null> {
  const keyProject = projectOfKey(ref);
  return keyProject ? tracker.getTicketByKey(keyProject, ref) : tracker.getTicket(projectId, ref);
}

/**
 * The tickets a status line needs (`ticketStatusLine`'s `tickets`): the ticket, its blockers in
 * its own project, and for a Ready ticket the Ready lane and those tickets' blockers, for its place
 * in the queue. Blockers in another project aren't on the board, so the line ignores them, as the
 * UI's does.
 */
export async function statusLineTickets(
  tracker: Pick<WorkTracker, "getTicket" | "getTicketByKey" | "listTickets">,
  ticket: Ticket,
): Promise<Ticket[]> {
  const ready =
    ticket.stage === "ready"
      ? (await tracker.listTickets(ticket.projectId, { stage: "ready" })).filter((t) => !t.archived)
      : [];
  const known = new Map([ticket, ...ready].map((t) => [t.id, t]));
  const isKnown = (ref: string) => [...known.values()].some((t) => t.id === ref || t.key === ref);
  const refs = new Set(
    [ticket, ...ready]
      .flatMap((t) => t.blockedBy)
      .filter((ref) => (projectOfKey(ref) ?? ticket.projectId) === ticket.projectId)
      .filter((ref) => !isKnown(ref)),
  );
  const blockers = await Promise.all(
    [...refs].map((ref) => ticketByRef(tracker, ticket.projectId, ref)),
  );
  for (const b of blockers) if (b) known.set(b.id, b);
  return [...known.values()];
}

/**
 * Every ticket a blocker chain from `refs` reaches, in any project, by key and by id
 * (`ticketsByRef`'s shape), plus the ticket itself. One read per ticket on the chain; an entry
 * that names nothing is left out. Refused past MAX_CHAIN_READS.
 */
export async function blockerChain(
  tracker: Pick<WorkTracker, "getTicket" | "getTicketByKey">,
  ticket: Ticket,
  refs: readonly string[],
): Promise<Map<string, Ticket>> {
  const byRef = new Map<string, Ticket>([
    [ticket.key, ticket],
    [ticket.id, ticket],
  ]);
  // Each pending entry with the project an id entry belongs to: its holder's.
  let pending = refs.map((ref) => ({ ref, projectId: ticket.projectId }));
  let reads = 0;
  while (pending.length > 0) {
    const fresh = pending.filter(
      (p, i) => !byRef.has(p.ref) && pending.findIndex((q) => q.ref === p.ref) === i,
    );
    reads += fresh.length;
    if (reads > MAX_CHAIN_READS) {
      throw new DomainError(
        "invalid_reference",
        `the blocker chain from ${ticket.key} is longer than ${MAX_CHAIN_READS} tickets`,
      );
    }
    const found = await Promise.all(fresh.map((p) => ticketByRef(tracker, p.projectId, p.ref)));
    pending = [];
    fresh.forEach((p, i) => {
      const t = found[i];
      if (!t) return;
      byRef.set(p.ref, t);
      byRef.set(t.key, t);
      byRef.set(t.id, t);
      pending.push(...t.blockedBy.map((ref) => ({ ref, projectId: t.projectId })));
    });
  }
  return byRef;
}

/**
 * The parent and its ancestors, nearest first, for `parentProblem`'s cycle check. Stops at a
 * ticket without a parent, a parent that isn't found, or a loop. Refused past MAX_CHAIN_READS.
 */
export async function parentChain(
  tracker: Pick<WorkTracker, "getTicket">,
  projectId: string,
  parentId: string,
): Promise<Ticket[]> {
  const chain: Ticket[] = [];
  const seen = new Set<string>();
  for (let id: string | null = parentId; id && !seen.has(id);) {
    if (chain.length >= MAX_CHAIN_READS) {
      throw new DomainError(
        "invalid_reference",
        `the epic chain is longer than ${MAX_CHAIN_READS}`,
      );
    }
    seen.add(id);
    const t: Ticket | null = await tracker.getTicket(projectId, id);
    if (!t) break;
    chain.push(t);
    id = t.parentId;
  }
  return chain;
}
