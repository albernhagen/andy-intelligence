import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  NewProject,
  NewQuestion,
  NewTicket,
  Project,
  Question,
  Stage,
  Ticket,
  TicketEvent,
  TicketKey,
  TicketFields,
  Timestamp,
} from "@andy/contracts";
import type { ProjectService, TicketService } from "@andy/domain";
import type { WorkTracker } from "@andy/contracts";
import type { AuthEnv } from "./auth";

/** Ticket core REST API (M1.2: Ticket core). Every caller here is Andy (allow-list), so actor = "andy". */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const ok = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const errors = {
  400: ok(ErrorBody, "Invalid request"),
  404: ok(ErrorBody, "Not found"),
  409: ok(ErrorBody, "Conflict"),
  422: ok(ErrorBody, "Rule violation"),
};
const body = <S extends z.ZodType>(schema: S) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

// Ids are checked before they reach storage paths: a project id is its lowercased key,
// ticket and question ids are UUIDs. Anything else is a 400, never a storage error.
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });
const TicketParams = ProjectParams.extend({ ticketId: z.uuid() });
const QuestionParams = z.object({ questionId: z.uuid() });

/** Callers can't set derived fields; the domain computes them. */
const CreateTicket = NewTicket.omit({ dorStatus: true, needsYou: true });
const PatchTicket = TicketFields.omit({ dorStatus: true, archived: true }).extend({
  ifUpdatedAt: Timestamp.optional(),
});
const MoveStage = z.object({
  to: Stage,
  force: z.boolean().default(false),
  reason: z.string().nullable().default(null),
});
const CancelTicket = z.object({ reason: z.string().nullable().default(null) });
const ArchiveTicket = z.object({ archived: z.boolean().default(true) });
const Comment = z.object({ body: z.string().min(1) });
const Answer = z.object({ answer: z.string().min(1) });
const Readiness = z.object({ met: z.boolean(), missing: z.array(z.string()) });
const NeedsYou = z.object({ questions: z.array(Question), tickets: z.array(Ticket) });
const BoolQuery = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();
const TicketQuery = z.object({ stage: Stage.optional(), needsYou: BoolQuery, archived: BoolQuery });

const secured = { security: [{ bearer: [] }] };

const routes = {
  listProjects: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects",
    responses: { 200: ok(z.array(Project), "Projects") },
  }),
  createProject: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects",
    request: body(NewProject),
    responses: { 201: ok(Project, "Created"), ...errors },
  }),
  getProject: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}",
    request: { params: ProjectParams },
    responses: { 200: ok(Project, "Project"), ...errors },
  }),
  listTickets: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/tickets",
    request: { params: ProjectParams, query: TicketQuery },
    responses: { 200: ok(z.array(Ticket), "Tickets, by rank"), ...errors },
  }),
  createTicket: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/tickets",
    request: { params: ProjectParams, ...body(CreateTicket) },
    responses: { 201: ok(Ticket, "Created in backlog"), ...errors },
  }),
  getTicket: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/tickets/{ticketId}",
    request: { params: TicketParams },
    responses: { 200: ok(Ticket, "Ticket"), ...errors },
  }),
  getTicketByKey: createRoute({
    ...secured,
    method: "get",
    path: "/api/tickets/{key}",
    request: { params: z.object({ key: TicketKey }) },
    responses: { 200: ok(Ticket, "Ticket"), ...errors },
  }),
  patchTicket: createRoute({
    ...secured,
    method: "patch",
    path: "/api/projects/{projectId}/tickets/{ticketId}",
    request: { params: TicketParams, ...body(PatchTicket) },
    responses: { 200: ok(Ticket, "Updated"), ...errors },
  }),
  readiness: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/tickets/{ticketId}/readiness",
    request: { params: TicketParams },
    responses: { 200: ok(Readiness, "Definition of Ready check"), ...errors },
  }),
  moveStage: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/tickets/{ticketId}/stage",
    request: { params: TicketParams, ...body(MoveStage) },
    responses: { 200: ok(Ticket, "Moved"), ...errors },
  }),
  cancelTicket: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/tickets/{ticketId}/cancel",
    request: { params: TicketParams, ...body(CancelTicket) },
    responses: { 200: ok(Ticket, "Cancelled; runs in flight stopped first"), ...errors },
  }),
  archiveTicket: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/tickets/{ticketId}/archive",
    request: { params: TicketParams, ...body(ArchiveTicket) },
    responses: { 200: ok(Ticket, "Archived or unarchived"), ...errors },
  }),
  listEvents: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/tickets/{ticketId}/events",
    request: { params: TicketParams },
    responses: { 200: ok(z.array(TicketEvent), "History, oldest first"), ...errors },
  }),
  addComment: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/tickets/{ticketId}/comments",
    request: { params: TicketParams, ...body(Comment) },
    responses: { 201: ok(TicketEvent, "Comment added"), ...errors },
  }),
  listTicketQuestions: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/tickets/{ticketId}/questions",
    request: { params: TicketParams },
    responses: { 200: ok(z.array(Question), "Questions, oldest first"), ...errors },
  }),
  askQuestion: createRoute({
    ...secured,
    method: "post",
    path: "/api/projects/{projectId}/tickets/{ticketId}/questions",
    request: { params: TicketParams, ...body(NewQuestion) },
    responses: { 201: ok(Question, "Asked; ticket flagged Needs-you"), ...errors },
  }),
  answerQuestion: createRoute({
    ...secured,
    method: "post",
    path: "/api/questions/{questionId}/answer",
    request: { params: QuestionParams, ...body(Answer) },
    responses: { 200: ok(Question, "Answered"), ...errors },
  }),
  needsYou: createRoute({
    ...secured,
    method: "get",
    path: "/api/needs-you",
    responses: { 200: ok(NeedsYou, "Open questions and flagged tickets") },
  }),
};

const notFound = (what: string) => ({ error: `${what} not found` });

export function registerTicketRoutes(
  app: OpenAPIHono<AuthEnv>,
  tracker: WorkTracker,
  service: TicketService,
  projects: ProjectService,
): void {
  app.openapi(routes.listProjects, async (c) => c.json(await tracker.listProjects(), 200));

  app.openapi(routes.createProject, async (c) =>
    c.json(await projects.register(c.req.valid("json")), 201),
  );

  app.openapi(routes.getProject, async (c) => {
    const project = await tracker.getProject(c.req.valid("param").projectId);
    return project ? c.json(project, 200) : c.json(notFound("project"), 404);
  });

  app.openapi(routes.listTickets, async (c) => {
    const { projectId } = c.req.valid("param");
    if (!(await tracker.getProject(projectId))) return c.json(notFound("project"), 404);
    return c.json(await tracker.listTickets(projectId, c.req.valid("query")), 200);
  });

  app.openapi(routes.createTicket, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await service.create(projectId, c.req.valid("json"), "andy"), 201);
  });

  app.openapi(routes.getTicket, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const ticket = await tracker.getTicket(projectId, ticketId);
    return ticket ? c.json(ticket, 200) : c.json(notFound("ticket"), 404);
  });

  // Readable links (AI-7): the UI routes by key, e.g. /p/ai/t/AI-2. Reads the project's
  // tickets, like MCP `status` (cost note: ARCHITECTURE §7.1).
  app.openapi(routes.getTicketByKey, async (c) =>
    c.json(await service.findByKey(c.req.valid("param").key), 200),
  );

  app.openapi(routes.patchTicket, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const { ifUpdatedAt, ...fields } = c.req.valid("json");
    return c.json(await service.update(projectId, ticketId, fields, "andy", ifUpdatedAt), 200);
  });

  app.openapi(routes.readiness, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await service.readiness(projectId, ticketId), 200);
  });

  app.openapi(routes.moveStage, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const { to, force, reason } = c.req.valid("json");
    return c.json(await service.move(projectId, ticketId, to, "andy", { force, reason }), 200);
  });

  app.openapi(routes.cancelTicket, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    return c.json(await service.cancel(projectId, ticketId, "andy", reason), 200);
  });

  app.openapi(routes.archiveTicket, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const { archived } = c.req.valid("json");
    return c.json(await service.archive(projectId, ticketId, archived, "andy"), 200);
  });

  app.openapi(routes.listEvents, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await service.history(projectId, ticketId), 200);
  });

  app.openapi(routes.addComment, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(
      await service.comment(projectId, ticketId, c.req.valid("json").body, "andy"),
      201,
    );
  });

  app.openapi(routes.listTicketQuestions, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    if (!(await tracker.getTicket(projectId, ticketId))) return c.json(notFound("ticket"), 404);
    return c.json(await tracker.listQuestions({ projectId, ticketId }), 200);
  });

  app.openapi(routes.askQuestion, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await service.ask(projectId, ticketId, c.req.valid("json"), "andy"), 201);
  });

  app.openapi(routes.answerQuestion, async (c) => {
    // The channel is set by the route, not the caller, so history can't claim a channel the
    // request didn't use. MCP tools (M1.4) answer with "mcp".
    const { answer } = c.req.valid("json");
    return c.json(await service.answer(c.req.valid("param").questionId, answer, "ui", "andy"), 200);
  });

  app.openapi(routes.needsYou, async (c) => c.json(await service.needsYou(), 200));
}
