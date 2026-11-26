import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  ProjectLogoView,
  SetProjectLogo,
  notFound,
  type EventActor,
  type ProjectLogoStore,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError, requireCan } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";
import { checkLogo } from "./logo-sanitize";
import type { RouteModule } from "./services";

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "project-logos", ...fields }));
}

/**
 * Project logos (AI-393). Reading is open to whoever may read the project; storing or removing
 * one is owner-only, like every project setting. An upload goes through `checkLogo` and is
 * refused with its reason (422) or stored sanitized; the project's `logoUpdatedAt` then tells
 * every reader to fetch it again. Shared by the routes below and the MCP tools.
 */
export class ProjectLogoService {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly store: ProjectLogoStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(projectId: string): Promise<ProjectLogoView> {
    await this.requireProject(projectId);
    const logo = await this.store.get(projectId);
    return { logo: logo && { format: logo.format, data: logo.data, updatedAt: logo.updatedAt } };
  }

  async set(projectId: string, input: SetProjectLogo, actor: EventActor): Promise<ProjectLogoView> {
    requireCan(actor, "change_project_settings", projectId);
    await this.requireProject(projectId);
    const checked = checkLogo(SetProjectLogo.parse(input));
    if (!checked.ok) {
      log("WARNING", "logo refused", { projectId, format: input.format, reason: checked.reason });
      throw new DomainError("invalid_field", "logo refused", [checked.reason]);
    }
    const updatedAt = this.now().toISOString();
    const stored = await this.store.put({
      projectId,
      format: input.format,
      data: checked.data,
      updatedAt,
      updatedBy: actor,
    });
    await this.tracker.updateProject(projectId, { logoUpdatedAt: updatedAt });
    log("INFO", "logo stored", {
      projectId,
      format: input.format,
      bytes: checked.data.length,
      by: actor,
    });
    return { logo: { format: stored.format, data: stored.data, updatedAt } };
  }

  async remove(projectId: string, actor: EventActor): Promise<ProjectLogoView> {
    requireCan(actor, "change_project_settings", projectId);
    await this.requireProject(projectId);
    // The stamp first: a failed delete then leaves an unread file, never a stamp with no file.
    await this.tracker.updateProject(projectId, { logoUpdatedAt: null });
    await this.store.remove(projectId);
    log("INFO", "logo removed", { projectId, by: actor });
    return { logo: null };
  }

  private async requireProject(projectId: string): Promise<void> {
    if (!(await this.tracker.getProject(projectId))) throw notFound("project", projectId);
  }
}

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });
const errors = {
  400: json(ErrorBody, "Invalid request"),
  403: json(ErrorBody, "Only the owner"),
  404: json(ErrorBody, "Not found"),
  422: json(ErrorBody, "Logo refused, with the reason"),
};
const path = "/api/projects/{projectId}/logo";

const getRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path,
  request: { params: ProjectParams },
  responses: { 200: json(ProjectLogoView, "The logo, or null for the default mark"), ...errors },
});
const putRoute = createRoute({
  security: [{ bearer: [] }],
  method: "put",
  path,
  request: {
    params: ProjectParams,
    body: { content: { "application/json": { schema: SetProjectLogo } }, required: true },
  },
  responses: { 200: json(ProjectLogoView, "Stored, sanitized"), ...errors },
});
const deleteRoute = createRoute({
  security: [{ bearer: [] }],
  method: "delete",
  path,
  request: { params: ProjectParams },
  responses: { 200: json(ProjectLogoView, "Removed: the default mark shows"), ...errors },
});

export function registerProjectLogoRoutes(
  app: OpenAPIHono<AuthEnv>,
  logos: ProjectLogoService,
): void {
  app.openapi(getRoute, async (c) => c.json(await logos.get(c.req.valid("param").projectId), 200));
  app.openapi(putRoute, async (c) =>
    c.json(
      await logos.set(
        c.req.valid("param").projectId,
        c.req.valid("json"),
        actorOf(c.get("identity")),
      ),
      200,
    ),
  );
  app.openapi(deleteRoute, async (c) =>
    c.json(await logos.remove(c.req.valid("param").projectId, actorOf(c.get("identity"))), 200),
  );
}

/** Listed in `api-routes.ts`; absent without a logo store. */
export const apiRoutes: RouteModule = (app, s) => {
  if (s.logos) registerProjectLogoRoutes(app, s.logos);
};
