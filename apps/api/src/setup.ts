import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { notFound, type CodeHost, type WorkTracker } from "@andy/contracts";
import {
  BASELINE_FILES,
  SETUP_ITEMS,
  THREAT_MODEL_PATH,
  setupChecklist,
  type RepoFacts,
} from "@andy/domain";
import type { AuthEnv } from "./auth";

/**
 * A project's setup checklist (AI-95: M5.15): the five steps from AI-65, decided by the domain
 * from repo facts read here through the `CodeHost` port. Signed-in read only; it never does a
 * step. Each view reads the project's first repo once plus one file per baseline file and the
 * threat model (a fixed 15 calls, ADR-0028), in parallel.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

/** Cap on a code-host error shown in an item's detail (ADR-0028). */
const ERROR_MAX = 200;

const keys = Object.keys(SETUP_ITEMS) as [
  keyof typeof SETUP_ITEMS,
  ...(keyof typeof SETUP_ITEMS)[],
];
export const SetupChecklistBody = z
  .object({
    repo: z.string().nullable(),
    complete: z.boolean(),
    items: z.array(
      z.object({
        key: z.enum(keys),
        label: z.string(),
        status: z.enum(["done", "missing", "unknown", "not_yet"]),
        detail: z.string().nullable(),
      }),
    ),
  })
  .openapi("SetupChecklist");

const setupRoute = createRoute({
  security: [{ bearer: [] }],
  method: "get",
  path: "/api/projects/{projectId}/setup",
  request: { params: ProjectParams },
  responses: {
    200: json(SetupChecklistBody, "The five setup steps, each done, missing, unknown or not yet"),
    400: json(ErrorBody, "Invalid request"),
    404: json(ErrorBody, "Not found"),
  },
});

function log(message: string, fields: object) {
  console.log(JSON.stringify({ severity: "WARNING", message, component: "setup", ...fields }));
}

/** What the code host says about `repo`; a thrown error becomes an `error` fact, never "done". */
export async function readRepoFacts(
  codeHost: CodeHost | null,
  repo: string | undefined,
): Promise<RepoFacts> {
  if (!repo) return { kind: "no_repo" };
  if (!codeHost) return { kind: "not_installed", repo };
  try {
    const found = await codeHost.getRepo(repo);
    if (!found) return { kind: "not_installed", repo };
    const ref = found.defaultBranch;
    const present = async (path: string) =>
      (await codeHost.readFile(found.fullName, path, ref)) !== null;
    const [baseline, threatModel] = await Promise.all([
      Promise.all(
        BASELINE_FILES.map(async (path: string) => ((await present(path)) ? null : path)),
      ),
      present(THREAT_MODEL_PATH),
    ]);
    return {
      kind: "read" as const,
      repo: found.fullName,
      missingBaselineFiles: baseline.filter((p): p is string => p !== null),
      threatModel,
    };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);
    log("setup checklist couldn't read the repo", { repo, error });
    return { kind: "error", repo, error };
  }
}

export function registerSetupRoutes(
  app: OpenAPIHono<AuthEnv>,
  tracker: WorkTracker,
  codeHost: CodeHost | null,
): void {
  app.openapi(setupRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const project = await tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const facts = await readRepoFacts(codeHost, project.repos[0]);
    return c.json(setupChecklist(project, facts), 200);
  });
}
