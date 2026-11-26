import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  MarkStepBody,
  Onboarding,
  notFound,
  type CodeHost,
  type DeploymentStore,
  type EventActor,
  type MarkableStepKey,
  type Project,
  type ProvingRefine,
  type Run,
  type RunStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import {
  AGENT_ENVIRONMENT,
  ONBOARDING_DIRS,
  PROTECT_MAIN_RULESET,
  onboarding,
  type OnboardingRepoFacts,
  type ProjectService,
  type SettingFact,
} from "@andy/domain";
import { signedIn, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * A managed project's onboarding (AI-381): every step of runbook `managed-project.md` with its
 * status, for the setup path and MCP `project_setup`. The steps are decided by the domain from
 * facts read here: the repo, five folder listings and three settings through the `CodeHost` port
 * (at most 10 code-host calls, ADR-0028), cached per project, plus the project's refine tasks.
 * Read-only toward the code host: no step is run, no secret or token is read. Steps the App's
 * permissions can't read (Actions settings, secrets) are marked done by Andy, owner only.
 */

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

/** How long a code-host read is reused (ADR-0028): polls and reloads within it cost nothing. */
export const ONBOARDING_CACHE_MS = 60_000;
/** "Check again" reads afresh only when the cached read is at least this old. */
export const ONBOARDING_REFRESH_MIN_MS = 10_000;
/** Refine tasks looked at for the proving refine: the last 90 days, at most this many. */
export const REFINE_LOOKBACK_RUNS = 50;
const REFINE_LOOKBACK_MS = 90 * 24 * 60 * 60_000;
/**
 * When the window read was capped and held no refine, this many tickets that left Backlog are
 * asked for their own runs (one read each): other steps' runs can't hide a refine then.
 */
export const REFINE_TICKET_PROBES = 5;
/** Cap on a code-host error shown in a check's detail (ADR-0028). */
const ERROR_MAX = 200;
/** Cached projects at most; the oldest entry goes first. */
const CACHE_MAX = 100;

function log(severity: "INFO" | "WARNING", message: string, fields: object) {
  console.log(JSON.stringify({ severity, message, component: "onboarding", ...fields }));
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);

/** One settings read: the value, or why it couldn't be read (a refusal is never "not set"). */
async function setting<T>(
  host: CodeHost,
  repo: string,
  subpath: string,
  decide: (status: number, data: unknown) => T,
): Promise<SettingFact<T>> {
  try {
    const read = await host.readRepoSetting(repo, subpath);
    if (!read) return { kind: "unknown", error: "the GitHub App can't see the repo" };
    if (read.status === 401 || read.status === 403) {
      return { kind: "unknown", error: `the GitHub App may not read ${subpath}` };
    }
    if (read.status !== 200 && read.status !== 404) {
      return { kind: "unknown", error: `${subpath} answered ${read.status}` };
    }
    return { kind: "read", value: decide(read.status, read.data) };
  } catch (err) {
    return { kind: "unknown", error: errorText(err) };
  }
}

const rulesetActive = (status: number, data: unknown) =>
  status === 200 &&
  Array.isArray(data) &&
  data.some(
    (r: { name?: unknown; enforcement?: unknown }) =>
      r.name === PROTECT_MAIN_RULESET && r.enforcement === "active",
  );

/** Reads what the steps need from the code host: the repo, its folders and three settings. */
export async function readOnboardingRepo(
  host: CodeHost | null,
  repo: string | undefined,
): Promise<OnboardingRepoFacts> {
  if (!repo) return { kind: "no_repo" };
  if (!host) return { kind: "not_installed", repo };
  try {
    const found = await host.getRepo(repo);
    if (!found) return { kind: "not_installed", repo };
    const name = found.fullName;
    const listings = await Promise.all(
      ONBOARDING_DIRS.map((dir) => host.listFiles(name, dir, found.defaultBranch)),
    );
    const env = `environments/${AGENT_ENVIRONMENT}`;
    const [ruleset, environment] = await Promise.all([
      setting(host, name, "rulesets", rulesetActive),
      setting(host, name, env, (status, data) => ({
        exists: status === 200,
        custom:
          status === 200 &&
          (data as { deployment_branch_policy?: { custom_branch_policies?: unknown } } | null)
            ?.deployment_branch_policy?.custom_branch_policies === true,
      })),
    ]);
    // Main only: custom branch rules that are exactly `main`. One more read, only when needed.
    let env2: SettingFact<{ exists: boolean; mainOnly: boolean }> =
      environment.kind === "unknown"
        ? environment
        : { kind: "read", value: { exists: environment.value.exists, mainOnly: false } };
    if (environment.kind === "read" && environment.value.custom) {
      const policies = await setting(host, name, `${env}/deployment-branch-policies`, (s, d) => {
        const list = (d as { branch_policies?: { name?: unknown; type?: unknown }[] } | null)
          ?.branch_policies;
        return (
          s === 200 &&
          Array.isArray(list) &&
          list.length === 1 &&
          list[0]?.name === "main" &&
          (list[0]?.type ?? "branch") === "branch"
        );
      });
      env2 =
        policies.kind === "unknown"
          ? policies
          : { kind: "read", value: { exists: true, mainOnly: policies.value } };
    }
    return {
      kind: "read",
      repo: name,
      private: found.private,
      defaultBranch: found.defaultBranch,
      files: Object.fromEntries(ONBOARDING_DIRS.map((dir, i) => [dir, listings[i] ?? null])),
      ruleset,
      environment: env2,
    };
  } catch (err) {
    const error = errorText(err);
    log("WARNING", "onboarding couldn't read the repo", { repo, error });
    return { kind: "error", repo, error };
  }
}

/** The newest refine task in the project, and an Up-next ticket a refine can start on. */
export async function provingRefine(
  tracker: WorkTracker,
  runs: RunStore,
  projectId: string,
  now: Date,
): Promise<ProvingRefine> {
  const from = new Date(now.getTime() - REFINE_LOOKBACK_MS).toISOString();
  const [active, ended, tickets] = await Promise.all([
    runs.listActive(projectId),
    runs.listEndedBetween(projectId, from, now.toISOString(), REFINE_LOOKBACK_RUNS),
    tracker.listTickets(projectId),
  ]);
  const refine = (r: Run) => r.step === "refine";
  const succeeded = (r: Run) => refine(r) && r.status === "succeeded";
  // One succeeded refine proves the step: a later failed or running one doesn't undo it. A capped
  // window may have cut it off, so the ticket probe runs before an older failure is reported.
  const proved =
    ended.runs.find(succeeded) ??
    (ended.complete ? undefined : await probeTickets(runs, projectId, tickets, succeeded));
  const latest: Run | undefined = proved ?? active.find(refine) ?? ended.runs.find(refine);
  // Capped and no success found: say so rather than "none" or "failed", since a refine may have
  // passed out of sight; the newest one seen still gives its link and error.
  const unseen = !proved && !ended.complete && !active.some(refine);
  const keyOf = (id: string | null) => tickets.find((t) => t.id === id)?.key ?? null;
  const candidate = tickets.find(
    (t) => t.stage === "backlog" && !t.archived && t.upNextRank !== null && t.type !== "epic",
  );
  const status: ProvingRefine["status"] = unseen
    ? "unknown"
    : !latest
      ? "none"
      : latest.status === "succeeded"
        ? "succeeded"
        : latest.status === "queued" || latest.status === "running"
          ? "running"
          : "failed";
  return {
    runId: latest?.id ?? null,
    ticketKey: latest ? keyOf(latest.ticketId) : null,
    status,
    url: latest?.links.executorRun ?? null,
    error: latest?.error?.slice(0, ERROR_MAX) ?? null,
    candidate: candidate ? { id: candidate.id, key: candidate.key, title: candidate.title } : null,
  };
}

/**
 * The window read hit its cap (other steps' runs, or other projects' in the store, fill it), so
 * look at the newest refined tickets' own runs instead, at most REFINE_TICKET_PROBES reads.
 */
async function probeTickets(
  runs: RunStore,
  projectId: string,
  tickets: Ticket[],
  succeeded: (r: Run) => boolean,
): Promise<Run | undefined> {
  const refined = tickets
    .filter((t) => t.stage !== "backlog" && t.type !== "epic")
    .sort((a, b) => (b.upNextAt ?? "").localeCompare(a.upNextAt ?? ""))
    .slice(0, REFINE_TICKET_PROBES);
  for (const t of refined) {
    const hit = (await runs.listForTicket(projectId, t.id)).find(succeeded);
    if (hit) return hit;
  }
  return undefined;
}

interface Cached {
  at: number;
  repo: string | undefined;
  facts: OnboardingRepoFacts;
}

/** The project's onboarding, one way for the setup path and MCP `project_setup`. */
export class OnboardingReader {
  private readonly cache = new Map<string, Cached>();

  constructor(
    private readonly tracker: WorkTracker,
    private readonly runs: RunStore,
    private readonly codeHost: CodeHost | null,
    /** Where Andy installs the App; null when the App isn't connected. */
    private readonly appInstallUrl: () => Promise<string | null>,
    private readonly now: () => Date = () => new Date(),
    /** Deployment records (AI-109): a succeeded one shows the deploy environments applied. */
    private readonly deployments: DeploymentStore | null = null,
  ) {}

  async read(projectId: string, opts: { refresh?: boolean } = {}): Promise<Onboarding> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const now = this.now();
    const [repo, appInstallUrl, refine, deployed] = await Promise.all([
      this.repoFacts(project, now.getTime(), opts.refresh === true),
      this.appInstallUrl(),
      provingRefine(this.tracker, this.runs, projectId, now),
      this.hasDeployed(project),
    ]);
    return onboarding({
      repoCount: project.repos.length,
      repo: repo.facts,
      appInstallUrl,
      refine,
      buildEnabled: project.buildEnabled,
      deployKind: project.deployKind,
      deployed,
      marks: project.setupMarks,
      readAt: new Date(repo.at).toISOString(),
    });
  }

  /**
   * Whether the project has a succeeded deployment to either environment (two reads, only for a
   * project that deploys). A failed read counts as no: the step then waits for Andy's mark.
   */
  private async hasDeployed(project: Project): Promise<boolean> {
    if (project.deployKind === "none" || !this.deployments) return false;
    try {
      const good = await Promise.all(
        (["prod", "dev"] as const).map((env) => this.deployments!.latestGood(project.id, env)),
      );
      return good.some((d) => d !== null);
    } catch (err) {
      log("WARNING", "onboarding deployments read failed", {
        projectId: project.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** Forgets a project's cached read, e.g. after its repo changed. */
  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }

  private async repoFacts(project: Project, now: number, refresh: boolean): Promise<Cached> {
    const repo = project.repos[0];
    const hit = this.cache.get(project.id);
    const age = hit ? now - hit.at : Infinity;
    const fresh =
      hit?.repo === repo && age < (refresh ? ONBOARDING_REFRESH_MIN_MS : ONBOARDING_CACHE_MS);
    if (hit && fresh) return hit;
    const entry = { at: now, repo, facts: await readOnboardingRepo(this.codeHost, repo) };
    this.cache.delete(project.id);
    this.cache.set(project.id, entry);
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return entry;
  }
}

const routes = {
  read: createRoute({
    security: [{ bearer: [] }],
    method: "get",
    path: "/api/projects/{projectId}/onboarding",
    request: {
      params: ProjectParams,
      query: z.object({ refresh: z.enum(["true", "false"]).optional() }),
    },
    responses: {
      200: json(Onboarding, "Every onboarding step with its status"),
      400: json(ErrorBody, "Invalid request"),
      404: json(ErrorBody, "Not found"),
    },
  }),
  mark: createRoute({
    security: [{ bearer: [] }],
    method: "post",
    path: "/api/projects/{projectId}/onboarding/marks",
    request: {
      params: ProjectParams,
      body: { content: { "application/json": { schema: MarkStepBody } }, required: true },
    },
    responses: {
      200: json(Onboarding, "The steps after the mark"),
      400: json(ErrorBody, "Invalid request"),
      403: json(ErrorBody, "Owner only"),
      404: json(ErrorBody, "Not found"),
    },
  }),
};

/** Marks a step and answers the steps as they now read: the route's and the tool's one path. */
export async function markStep(
  projects: ProjectService,
  reader: OnboardingReader,
  projectId: string,
  step: MarkableStepKey,
  done: boolean,
  by: { actor: EventActor; email: string },
): Promise<Onboarding> {
  await projects.markSetupStep(projectId, step, done, by);
  return reader.read(projectId);
}

export function registerOnboardingRoutes(
  app: OpenAPIHono<AuthEnv>,
  reader: OnboardingReader,
  projects: ProjectService,
): void {
  app.openapi(routes.read, async (c) => {
    const { refresh } = c.req.valid("query");
    return c.json(
      await reader.read(c.req.valid("param").projectId, { refresh: refresh === "true" }),
      200,
    );
  });
  app.openapi(routes.mark, async (c) => {
    const { step, done } = c.req.valid("json");
    const projectId = c.req.valid("param").projectId;
    return c.json(
      await markStep(projects, reader, projectId, step, done, signedIn(c.get("identity"))),
      200,
    );
  });
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) =>
  registerOnboardingRoutes(app, s.onboarding, s.projects);
