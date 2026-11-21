import { TicketKey, notFound, projectIdFor, type EventActor } from "@andy/contracts";
import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { actorOf, type AuthEnv } from "./auth";

/**
 * One project-access check for every API route and MCP tool that names a project (AI-252: M8.3).
 * A project the caller can't read looks the same as one that doesn't exist: 404 on the API, a
 * "not found" tool error on MCP, never 403. A route or tool names its project in its path or
 * input; the rest are listed below as cross-project (M8.7 filters them), and anything else is
 * refused (fail closed). Today every allow-listed caller is the owner.
 */
export interface ProjectAccess {
  canRead(actor: EventActor, projectId: string): Promise<boolean>;
}

/**
 * Today's rule, passed explicitly by `main.ts` and the tests (there is no default): one owner, so
 * every caller past the allow-list reads every project. M8.5 replaces it with membership lookups.
 */
export function ownerOnlyAccess(): ProjectAccess {
  return { canRead: () => Promise.resolve(true) };
}

/**
 * `/api` routes that name no project in their path, each with how M8.7 (cross-project lists per
 * member) will filter it. Any other route without a project in its path is refused.
 */
export const CROSS_PROJECT_ROUTES: Readonly<Record<string, string>> = {
  "GET /api/config-changes": "Pending changes of every project: keep readable projects.",
  "GET /api/dashboard": "Every project's counts: keep readable projects.",
  "GET /api/github": "GitHub App connection: owner only.",
  "GET /api/github/manifest": "GitHub App setup: owner only.",
  "GET /api/me": "The caller's own identity: nothing to filter.",
  "GET /api/needs-you": "Every project's inbox: keep readable projects.",
  "GET /api/notify/email": "Needs-you email setting: owner only.",
  "GET /api/project-plans/waiting": "Every project's waiting plan: keep readable projects.",
  "GET /api/projects": "Every project: keep readable projects.",
  "GET /api/routing":
    "Every project's routing (a `projectId` query is checked): keep readable projects.",
  "GET /api/routing/changes":
    "Global routing's change log (AI-275): owner only (`change_routing`, enforced).",
  "GET /api/work":
    "Every project's open tickets (a `project` query is checked): keep readable projects.",
  "GET /api/quota": "Subscription quota: owner only.",
  "GET /api/runners": "Local runners: owner only.",
  "POST /api/config-changes/:changeId/accept": "Check the change's project.",
  "POST /api/config-changes/:changeId/reject": "Check the change's project.",
  "POST /api/github/connect": "GitHub App setup: owner only.",
  "POST /api/notify/email/test": "Needs-you email: owner only.",
  "POST /api/oauth/approve": "The caller's own MCP grant: nothing to filter.",
  "POST /api/projects": "Creates a project: owner only.",
  "POST /api/questions/:questionId/answer": "Check the question's ticket's project.",
  "POST /api/quota/clear": "Subscription quota: owner only.",
  "POST /api/routing/changes/:changeId/revert":
    "Reverts a global or project routing change (AI-275): the change's project is checked with canRead.",
  "POST /api/runners": "Local runners: owner only.",
  "POST /api/runners/:runnerId/revoke": "Local runners: owner only.",
  "PUT /api/routing": "Global model routing: owner only.",
};

/**
 * MCP tools that may run without naming a project (an optional `project` or `ticket` given is
 * still checked). Any other tool called without one is refused.
 */
export const CROSS_PROJECT_TOOLS: Readonly<Record<string, string>> = {
  accept_config_change: "Check the change's project.",
  answer_question: "Check the question's ticket's project.",
  clear_quota_idle: "Subscription quota: owner only.",
  get_routing: "Without `project`, the global routing: nothing to filter.",
  list_config_changes: "Without `project`, every project's changes: keep readable projects.",
  list_needs_me: "Every project's inbox: keep readable projects.",
  list_projects: "Every project: keep readable projects.",
  list_routing_changes:
    "Global routing's change log (AI-275): owner only (`change_routing`, enforced).",
  list_work: "Without `project`, every project's open tickets: keep readable projects.",
  reject_config_change: "Check the change's project.",
  revert_routing_change:
    "Reverts a global or project routing change (AI-275): the change's project is checked with canRead.",
  set_provider_routing: "Without `project`, the global routing: owner only.",
  set_step_tier: "Without `project`, the global routing: owner only.",
  set_tier_routes: "Without `project`, the global routing: owner only.",
  status: "Without `ticket`, every project's counts: keep readable projects.",
};

/** What a refused lookup names, and the body an unknown one gets. */
export interface ProjectTarget {
  projectId: string;
  /** The not-found error an unknown one gets, e.g. "project not found". */
  error: string;
}

/**
 * The project an `/api` path names: `/api/projects/{projectId}[/…]` or `/api/tickets/{KEY}[/…]`
 * (the key's prefix is the project). Null for every other path.
 */
export function projectOfPath(path: string): ProjectTarget | null {
  const project = /^\/api\/projects\/([^/]+)(?:\/|$)/.exec(path);
  if (project?.[1]) return { projectId: decode(project[1]), error: "project not found" };
  const ticket = /^\/api\/tickets\/([^/]+)(?:\/|$)/.exec(path);
  if (ticket?.[1]) return ticketTarget(decode(ticket[1]));
  return null;
}

/**
 * Input fields (MCP tool input, API request body) that hold ticket keys, one or a list.
 * `registries.test.ts` fails when a tool takes a ticket key in any other field.
 */
export const TICKET_KEY_FIELDS = [
  "ticket",
  "parent",
  "parentId",
  "blockedBy",
  "above",
  "below",
  "epic",
];

/**
 * The projects an input (MCP tool input or API request body) names: its `project`, and the
 * prefix of every ticket key in a `TICKET_KEY_FIELDS` field. A value that isn't a key (a ticket
 * id, which only ever resolves in the path's own project, or null) names nothing.
 */
export function projectsOfInput(input: unknown): ProjectTarget[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return [];
  const fields = input as Record<string, unknown>;
  const targets: ProjectTarget[] = [];
  if (typeof fields.project === "string") {
    const project = fields.project;
    targets.push({ projectId: projectIdFor(project), error: `project ${project} not found` });
  }
  for (const field of TICKET_KEY_FIELDS) {
    const value = fields[field];
    for (const key of Array.isArray(value) ? value : [value]) {
      const target = typeof key === "string" ? ticketTarget(key) : null;
      if (target) targets.push(target);
    }
  }
  return targets;
}

/** Query parameters that name a project (`/api/work?project=`, `/api/routing?projectId=`). */
export const PROJECT_QUERY_PARAMS = ["project", "projectId"];

/** The projects an `/api` query names: every value of a `PROJECT_QUERY_PARAMS` parameter. */
export function projectsOfQuery(query: Record<string, string[]>): ProjectTarget[] {
  return PROJECT_QUERY_PARAMS.flatMap((param) =>
    (query[param] ?? []).map((value) => ({
      projectId: projectIdFor(value),
      error: "project not found",
    })),
  );
}

/**
 * The `/api` check, after sign-in and the body cap. It checks the project a route's path names
 * and every project its query or JSON body names; a refusal is that thing's unknown-one 404. A route with
 * no project in its path passes only when listed in `CROSS_PROJECT_ROUTES`; any other is refused
 * with 404 (fail closed). A path no route matches falls through to the router's 404.
 */
export function requireProjectAccess(access: ProjectAccess): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const route = matchedRoute(c.req.method, matchedRoutes(c));
    const actor = actorOf(c.get("identity"));
    // A malformed ticket key names no project; its route still answers it (404) as before.
    const pathTarget = projectOfPath(c.req.path);
    if (!route && !pathTarget) return next();
    if (route && !isProjectRoute(route) && !(route in CROSS_PROJECT_ROUTES)) {
      log("ERROR", "route has no project scope", { actor, route });
      return c.json({ error: "not found" }, 404);
    }
    const targets = [
      ...(pathTarget ? [pathTarget] : []),
      ...projectsOfQuery(c.req.queries()),
      ...projectsOfInput(await jsonBody(c)),
    ];
    const refused = await refusedTarget(access, actor, targets, "api");
    return refused ? c.json({ error: refused.error }, 404) : next();
  };
}

/** The first project in `targets` the caller can't read, logged; null when all are readable. */
export async function refusedTarget(
  access: ProjectAccess,
  actor: EventActor,
  targets: ProjectTarget[],
  via: "api" | "mcp" = "mcp",
): Promise<ProjectTarget | null> {
  for (const target of targets) {
    if (!(await access.canRead(actor, target.projectId))) {
      log("WARNING", "project access refused", { via, actor, projectId: target.projectId });
      return target;
    }
  }
  return null;
}

/** True for a route pattern under `/api/projects/:projectId` or `/api/tickets/:key`. */
export function isProjectRoute(route: string): boolean {
  return /^[A-Z]+ \/api\/(projects\/:projectId|tickets\/:key)(\/|$)/.test(route);
}

/**
 * The handler route a request matched, as `METHOD /pattern`; null when only middleware did. Hono
 * answers HEAD with the GET handler, so HEAD matches as GET.
 */
function matchedRoute(method: string, routes: { method: string; path: string }[]): string | null {
  const as = method === "HEAD" ? "GET" : method;
  const handler = routes.findLast((r) => r.method === as && !r.path.endsWith("*"));
  return handler ? `${handler.method} ${handler.path}` : null;
}

/**
 * A write's body parsed as JSON whatever its content type, so no header can hide keys from the
 * check; null when there is none or it isn't JSON. Hono caches it for the route's own parsing.
 */
async function jsonBody(c: Context): Promise<unknown> {
  if (c.req.method === "GET" || c.req.method === "HEAD") return null;
  return c.req.json().catch(() => null);
}

function ticketTarget(key: string): ProjectTarget | null {
  if (!TicketKey.safeParse(key).success) return null;
  return {
    projectId: projectIdFor(key.slice(0, key.lastIndexOf("-"))),
    error: notFound("ticket", key).message,
  };
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A structured log line; refusals carry the actor (`user:<uid>`), never the email (ADR-0015). */
function log(severity: "WARNING" | "ERROR", message: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ severity, message, component: "project-access", ...fields }));
}
