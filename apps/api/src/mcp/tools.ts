import {
  NewTicket,
  Project,
  TicketKey,
  WorkTrackerError,
  type Question,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError, type RunService, type TicketService } from "@andy/domain";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * MCP core tools (M1.4: MCP core tools; `refine` from M1.7: Refinement). Thin adapters over
 * TicketService and RunService, the same rules the REST API and UI use. Every caller is Andy (allow-list), so actor = "andy", and answers are
 * recorded with answeredVia = "mcp".
 */

export interface ToolDeps {
  tracker: WorkTracker;
  service: TicketService;
  runs: RunService;
  /** Signed-in email, shown by `status` so it doubles as the connection check. */
  email: string;
}

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "AI". Call `status` with no ticket to list projects.');

/** Callers can't set derived fields (dorStatus, needsYou), as in the REST API. */
const CreateTicketInput = NewTicket.omit({ dorStatus: true, needsYou: true }).extend({
  project: ProjectKey,
}).shape;

const AnswerInput = {
  questionId: z.uuid().describe("Question id from `list_needs_me`."),
  answer: z.string().trim().min(1),
};

const RefineInput = {
  ticket: TicketKey.describe(
    'Ticket key, e.g. "AI-42". Must be in Backlog with no open questions.',
  ),
};

const StatusInput = {
  ticket: TicketKey.optional().describe('Ticket key, e.g. "AI-42". Omit for an overview.'),
};

const summary = (t: Ticket) => ({
  key: t.key,
  title: t.title,
  type: t.type,
  stage: t.stage,
  dorStatus: t.dorStatus,
  needsYou: t.needsYou,
});

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { tracker, service } = deps;

  server.registerTool(
    "create_ticket",
    {
      description:
        "Creates a ticket in a project's backlog. Returns its key and what the Definition of Ready still needs.",
      inputSchema: CreateTicketInput,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    ({ project, ...input }) =>
      run(async () => {
        const ticket = await service.create(project.toLowerCase(), input, "andy");
        const readiness = await service.readiness(ticket.projectId, ticket.id);
        return { ticket: summary(ticket), readiness };
      }),
  );

  server.registerTool(
    "list_needs_me",
    {
      description:
        "Lists the Needs-you inbox across projects: open questions (answer with `answer_question`) and flagged tickets.",
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const inbox = await service.needsYou();
        const keys = await ticketKeys(tracker, inbox.questions, inbox.tickets);
        return {
          questions: inbox.questions.map((q) => ({
            id: q.id,
            ticket: keys.get(q.ticketId) ?? null,
            text: q.text,
            options: q.options,
            suggestedAnswer: q.suggestedAnswer,
            assumptions: q.assumptions,
            urgency: q.urgency,
            // Agent-written text is untrusted (threat model R15): say which run asked.
            askedByRun: q.runId,
            createdAt: q.createdAt,
          })),
          tickets: inbox.tickets.map(summary),
        };
      }),
  );

  server.registerTool(
    "answer_question",
    {
      description:
        "Answers an open question. Re-checks the ticket's Definition of Ready and clears Needs-you when nothing is open.",
      inputSchema: AnswerInput,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    ({ questionId, answer }) =>
      run(async () => {
        const question = await service.answer(questionId, answer, "mcp", "andy");
        const ticket = await tracker.getTicket(question.projectId, question.ticketId);
        return { question, ticket: ticket && summary(ticket) };
      }),
  );

  server.registerTool(
    "refine",
    {
      description:
        "Starts a refine run on a Backlog ticket: an agent reads the ticket and the repo and asks 1-5 questions, which arrive in `list_needs_me` when the run ends (a few minutes). Answering the last one moves the ticket to Ready if its Definition of Ready is met.",
      inputSchema: RefineInput,
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ ticket }) =>
      run(async () => {
        const found = await service.findByKey(ticket);
        const started = await deps.runs.start(found.projectId, found.id, "refine");
        return {
          run: {
            id: started.id,
            step: started.step,
            status: started.status,
            model: started.route.model,
            deadline: started.deadline,
            link: started.links.executorRun ?? null,
          },
        };
      }),
  );

  server.registerTool(
    "status",
    {
      description:
        "With a ticket key: its stage, Definition of Ready gaps, questions and recent history. Without: every project's ticket counts by stage and the Needs-you count.",
      inputSchema: StatusInput,
      annotations: { readOnlyHint: true },
    },
    ({ ticket }) =>
      run(async () =>
        ticket
          ? await service.status(ticket)
          : { signedInAs: deps.email, ...(await service.overview()) },
      ),
  );
}

/** Ticket keys for the inbox's questions; flagged tickets cover most, the rest are read. */
async function ticketKeys(tracker: WorkTracker, questions: Question[], flagged: Ticket[]) {
  const keys = new Map(flagged.map((t) => [t.id, t.key]));
  for (const q of questions) {
    if (keys.has(q.ticketId)) continue;
    const ticket = await tracker.getTicket(q.projectId, q.ticketId);
    if (ticket) keys.set(ticket.id, ticket.key);
  }
  return keys;
}

/**
 * Rule violations and not-found/conflict come back as tool errors Claude can read and act on.
 * Anything else is logged and hidden behind "internal error", as the REST API does.
 */
async function run<T extends object>(fn: () => Promise<T>): Promise<CallToolResult> {
  try {
    const value = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      structuredContent: value as Record<string, unknown>,
    };
  } catch (err) {
    if (err instanceof DomainError || err instanceof WorkTrackerError) {
      const details = err instanceof DomainError && err.details.length > 0;
      const text = details ? `${err.message}: ${err.details.join(", ")}` : err.message;
      return { isError: true, content: [{ type: "text", text }] };
    }
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(
      JSON.stringify({
        severity: "ERROR",
        component: "mcp-tools",
        message: error.message,
        stack: error.stack,
      }),
    );
    return { isError: true, content: [{ type: "text", text: "internal error" }] };
  }
}
