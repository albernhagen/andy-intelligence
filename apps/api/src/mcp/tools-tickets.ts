import { TicketFields, TicketKey, Timestamp, type Ticket } from "@andy/contracts";
import {
  DomainError,
  inboxCards,
  ticketStatusLine,
  type InboxCard,
  type TicketStatus,
} from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run, summary, type ToolDeps } from "./tools";

/**
 * Parity tools (AI-40): each decision the UI offers on a ticket has a tool here. Rules live in
 * TicketService, shared with the REST API. Also the inbox view both harnesses and `status` read.
 */

/** Cards that get a status line and plan: each costs a few reads (ADR-0028). Past it: null. */
export const MAX_INBOX_CARD_DETAILS = 50;

const Key = TicketKey.describe('Ticket key, e.g. "AI-42".');

const EditInput = {
  ticket: Key,
  ...TicketFields.pick({
    type: true,
    title: true,
    body: true,
    acceptanceCriteria: true,
    assumptions: true,
    size: true,
    sizeReason: true,
    outOfScope: true,
    touches: true,
    overrides: true,
  }).shape,
  blockedBy: z
    .array(TicketKey)
    .optional()
    .describe("Keys of the tickets that block this one, in the same project. Replaces the list."),
  ifUpdatedAt: Timestamp.optional().describe(
    "The ticket's `updatedAt` from `status`: the edit is refused if it changed since.",
  ),
};

const CommentInput = { ticket: Key, body: z.string().trim().min(1) };

const ParentInput = {
  ticket: Key,
  parent: TicketKey.nullable().describe("An epic's key in the same project; null removes it."),
};

const ReorderInput = {
  ticket: Key,
  above: TicketKey.optional().describe("Place directly above this ticket."),
  below: TicketKey.optional().describe("Place directly below this ticket."),
};

/** `status` for a ticket with the status line the UI shows. */
export async function statusLineOf(deps: ToolDeps, status: TicketStatus) {
  const { ticket, questions } = status;
  const tickets = await deps.tracker.listTickets(ticket.projectId);
  const open = questions.filter((q) => q.status === "open").length;
  return { ...status, statusLine: await lineFor(deps, ticket, tickets, open) };
}

async function lineFor(
  deps: ToolDeps,
  ticket: Ticket,
  tickets: readonly Ticket[],
  openQuestions: number,
) {
  const [runs, events] = await Promise.all([
    deps.runs.list(ticket.projectId, ticket.id),
    deps.tracker.listEvents(ticket.projectId, ticket.id),
  ]);
  return ticketStatusLine(ticket, { tickets, runs, events, openQuestions }, new Date());
}

/** The plan a flagged ticket waits on, if any: `stale` can only be rejected or re-planned. */
async function planWaiting(deps: ToolDeps, ticket: Ticket) {
  const state = await deps.runs.planStateOf(ticket);
  return state.kind === "awaiting" || state.kind === "stale"
    ? { state: state.kind, runId: state.run.id, plan: state.run.plan }
    : null;
}

/** The inbox in the domain's order (`inboxCards`), one card per ticket. */
export async function listNeedsMe(deps: ToolDeps) {
  const inbox = await deps.service.needsYou();
  const { active, stale } = inboxCards(inbox);
  const ordered = [...active, ...stale];
  const projectIds = [...new Set(ordered.map((c) => c.projectId))];
  const listed = await Promise.all(projectIds.map((id) => deps.tracker.listTickets(id)));
  const byProject = new Map(projectIds.map((id, i) => [id, listed[i]!]));

  const cards = await Promise.all(
    ordered.map(async (card, index) => {
      const tickets = byProject.get(card.projectId) ?? [];
      const ticket = card.ticket ?? tickets.find((t) => t.id === card.ticketId);
      const detailed = ticket && index < MAX_INBOX_CARD_DETAILS;
      return {
        ticket: ticket ? summary(ticket) : null,
        stale: stale.includes(card),
        statusLine: detailed ? await lineFor(deps, ticket, tickets, card.questions.length) : null,
        questions: card.questions.map(questionView(ticket?.key ?? null)),
        plan: detailed && card.questions.length === 0 ? await planWaiting(deps, ticket) : null,
      };
    }),
  );
  return {
    cards,
    questions: cards.flatMap((c) => c.questions),
    tickets: inbox.tickets.map(summary),
  };
}

const questionView = (ticket: string | null) => (q: InboxCard["questions"][number]) => ({
  id: q.id,
  ticket,
  text: q.text,
  options: q.options,
  suggestedAnswer: q.suggestedAnswer,
  assumptions: q.assumptions,
  urgency: q.urgency,
  // Agent-written text is untrusted (threat model R15): say which run asked.
  askedByRun: q.runId,
  createdAt: q.createdAt,
});

export function registerTicketTools(server: McpServer, deps: ToolDeps): void {
  const { service, tracker } = deps;

  /** Blocker keys to ids; a key outside the ticket's project is refused. */
  const blockerIds = async (ticket: Ticket, keys: string[]) => {
    const tickets = await tracker.listTickets(ticket.projectId);
    return keys.map((key) => {
      const found = tickets.find((t) => t.key === key);
      if (!found) throw new DomainError("invalid_reference", `${key} is not in this project`);
      if (found.id === ticket.id) {
        throw new DomainError("invalid_reference", `${key} can't block itself`);
      }
      return found.id;
    });
  };

  server.registerTool(
    "edit_ticket",
    {
      description:
        "Edits a ticket's fields, as the ticket page does. Only the fields given change; lists replace the whole list. Re-checks the Definition of Ready.",
      inputSchema: EditInput,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ ticket, blockedBy, ifUpdatedAt, ...fields }) =>
      run(async () => {
        if (blockedBy === undefined && Object.values(fields).every((v) => v === undefined)) {
          throw new DomainError("invalid_reference", "give at least one field to edit");
        }
        const found = await service.findByKey(ticket);
        const edits = blockedBy
          ? { ...fields, blockedBy: await blockerIds(found, blockedBy) }
          : fields;
        const updated = await service.update(found.projectId, found.id, edits, "andy", ifUpdatedAt);
        return { ticket: summary(updated) };
      }),
  );

  server.registerTool(
    "comment_ticket",
    {
      description: "Adds a comment to a ticket's history, as Andy.",
      inputSchema: CommentInput,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    ({ ticket, body }) =>
      run(async () => {
        const found = await service.findByKey(ticket);
        return { comment: await service.comment(found.projectId, found.id, body, "andy") };
      }),
  );

  server.registerTool(
    "set_ticket_parent",
    {
      description:
        "Puts a ticket under an epic in the same project, or removes it from its epic with `parent: null`.",
      inputSchema: ParentInput,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ ticket, parent }) =>
      run(async () => ({ ticket: summary(await service.reparentByKey(ticket, parent, "andy")) })),
  );

  server.registerTool(
    "reorder_ticket",
    {
      description:
        "Moves a ticket within its lane, directly above or below another ticket in that lane; order is priority. Give exactly one of `above` or `below`. Up next and Ideas are separate lanes.",
      inputSchema: ReorderInput,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ ticket, above, below }) =>
      run(async () => {
        if ((above === undefined) === (below === undefined)) {
          throw new DomainError("invalid_reference", "give exactly one of `above` or `below`");
        }
        const anchor = above !== undefined ? { above } : { below: below! };
        return { ticket: summary(await service.reorderByKey(ticket, anchor, "andy")) };
      }),
  );
}
