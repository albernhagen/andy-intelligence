import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { MilestoneCase, MilestoneStatus, Stage } from "@andy/contracts";
import type {
  ProjectRoadmap as ProjectRoadmapValue,
  RoadmapEpic as RoadmapEpicValue,
  Roadmap as RoadmapValue,
  RoadmapReader,
} from "@andy/domain";
import { signedIn, type AuthEnv } from "./auth";
import type { ProjectAccess } from "./project-access";
import type { RouteModule } from "./services";

/**
 * The roadmap (AI-193: M4.25, ADR-0108): top-level epics with outcome, "Done when", state,
 * progress and open-ticket counts, grouped under the project's milestones in order (AI-305:
 * M4.35, ADR-0131), for one project or every readable one. Read-only; computed from each
 * project's board through the read cache (ADR-0126) and one milestone list; first 50 projects.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });
const Count = z.number().int().nonnegative();

const epicFields = {
  key: z.string(),
  title: z.string(),
  outcome: z.string().nullable(),
  doneWhen: z.array(z.string()),
  stage: Stage,
  state: z.enum(["not_started", "in_progress", "waiting_for_check", "done"]),
  progress: z.object({ done: Count, total: Count }),
  counts: z.object({
    needsYou: Count,
    inReview: Count,
    inProgress: Count,
    blocked: Count,
    notStarted: Count,
  }),
};
const ChildEpic = z.object({
  ...epicFields,
  children: z.tuple([]).describe("Always empty: nested one level only"),
});
const RoadmapEpic = z.object({
  ...epicFields,
  children: z.array(ChildEpic),
}) satisfies z.ZodType<RoadmapEpicValue>;

const RoadmapMilestone = z.object({
  id: z.string(),
  name: z.string(),
  outcome: z.string(),
  order: z.number().int(),
  status: MilestoneStatus,
  done: z.boolean().describe("Computed: approved, with every epic Done"),
  progress: z.object({ done: Count, total: Count }),
  counts: epicFields.counts,
  epicKeys: z.array(z.string()),
  case: MilestoneCase.nullable().describe("Why it is worth building (ADR-0149); null: none yet"),
  effort: z
    .object({
      tickets: Count,
      sizes: z.object({ S: Count, M: Count, L: Count, unsized: Count }),
    })
    .describe("Derived: its tickets that aren't Cancelled, and how many of each size"),
});

export const ProjectRoadmap = z
  .object({
    projectId: z.string(),
    projectKey: z.string(),
    projectName: z.string(),
    milestones: z.array(RoadmapMilestone),
    noMilestone: z.array(z.string()).describe("Top-level epics with no milestone, by key"),
    epics: z.array(RoadmapEpic),
    truncated: z.boolean(),
  })
  .openapi("ProjectRoadmap") satisfies z.ZodType<ProjectRoadmapValue>;

export const Roadmap = z
  .object({ projects: z.array(ProjectRoadmap), truncated: z.boolean() })
  .openapi("Roadmap") satisfies z.ZodType<RoadmapValue>;

const projectRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/roadmap",
  request: { params: ProjectParams },
  responses: {
    200: json(ProjectRoadmap, "The project's top-level epics with state, progress and counts"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

const allRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/roadmap",
  responses: {
    200: json(Roadmap, "One roadmap per readable project, first 50 by key"),
  },
});

export function registerRoadmapRoutes(
  app: OpenAPIHono<AuthEnv>,
  roadmap: RoadmapReader,
  access: ProjectAccess,
): void {
  app.openapi(projectRoute, async (c) =>
    c.json(await roadmap.project(c.req.valid("param").projectId), 200),
  );

  app.openapi(allRoute, async (c) => {
    const { actor } = signedIn(c.get("identity"));
    return c.json(await roadmap.all((projectId) => access.canRead(actor, projectId)), 200);
  });
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) =>
  registerRoadmapRoutes(app, s.roadmap, s.deps.projectAccess);
