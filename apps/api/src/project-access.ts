import { TicketKey, notFound, projectIdFor, type EventActor } from "@andy/contracts";
import type { MiddlewareHandler } from "hono";
import { actorOf, type AuthEnv } from "./auth";

/**
 * One project-access check for every API route and MCP tool that names a project (AI-252: M8.3).
 * A project the caller can't read looks the same as one that doesn't exist: 404 on the API, a
 * "not found" tool error on MCP, never 403. Cross-project routes and tools are listed in
 * `registries.test.ts` (M8.7 filters them). Today every allow-listed caller is the owner.
 */
export interface ProjectAccess {
  canRead(actor: EventActor, projectId: string): Promise<boolean>;
}

/** Today's rule: one owner, so every signed-in (allow-listed) caller reads every project. */
export const ALLOW_SIGNED_IN: ProjectAccess = { canRead: () => Promise.resolve(true) };

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
 * MCP input fields that hold ticket keys (one, or a list). `registries.test.ts` fails when a tool
 * takes a ticket key in any other field.
 */
export const TICKET_KEY_FIELDS = ["ticket", "parent", "parentId", "blockedBy", "above", "below"];

/**
 * The projects a tool's parsed input names: its `project`, and the prefix of every ticket key in
 * a `TICKET_KEY_FIELDS` field. A value that isn't a key (a ticket id, null) names nothing.
 */
export function projectsOfToolInput(args: unknown): ProjectTarget[] {
  if (typeof args !== "object" || args === null) return [];
  const input = args as Record<string, unknown>;
  const targets: ProjectTarget[] = [];
  if (typeof input.project === "string") {
    const project = input.project;
    targets.push({ projectId: projectIdFor(project), error: `project ${project} not found` });
  }
  for (const field of TICKET_KEY_FIELDS) {
    const value = input[field];
    for (const key of Array.isArray(value) ? value : [value]) {
      const target = typeof key === "string" ? ticketTarget(key) : null;
      if (target) targets.push(target);
    }
  }
  return targets;
}

/** Refuses an `/api` request for a project the caller can't read, with the unknown-one 404. */
export function requireProjectAccess(
  access: ProjectAccess = ALLOW_SIGNED_IN,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const target = projectOfPath(c.req.path);
    if (!target) return next();
    const actor = actorOf(c.get("identity"));
    if (await access.canRead(actor, target.projectId)) return next();
    logRefusal("api", actor, target.projectId);
    return c.json({ error: target.error }, 404);
  };
}

/** The first project in `targets` the caller can't read, logged; null when all are readable. */
export async function refusedTarget(
  access: ProjectAccess,
  actor: EventActor,
  targets: ProjectTarget[],
): Promise<ProjectTarget | null> {
  for (const target of targets) {
    if (!(await access.canRead(actor, target.projectId))) {
      logRefusal("mcp", actor, target.projectId);
      return target;
    }
  }
  return null;
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

/** WARNING with the actor (`user:<uid>`) and project; never the email (ADR-0015). */
function logRefusal(via: "api" | "mcp", actor: EventActor, projectId: string): void {
  console.log(
    JSON.stringify({
      severity: "WARNING",
      message: "project access refused",
      component: "project-access",
      via,
      actor,
      projectId,
    }),
  );
}
