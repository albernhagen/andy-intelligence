import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  CONFIG_CHANGE_LIST_MAX,
  ConfigChange,
  EffectiveSpendCaps,
  ProjectSpendCaps,
  type ProviderSpendTotals,
  SpendCaps,
  SpendSoFar,
  notFound,
  type EventActor,
  type SpendLedger,
} from "@andy/contracts";
import { spendView, type GlobalSpendCaps, type ProjectService, type SpendView } from "@andy/domain";
import { actorOf, signedIn, type AuthEnv } from "./auth";
import type { RouteModule } from "./services";

/**
 * Spend caps settings (AI-249: M10.8), under /api (Firebase sign-in + allow-list). Reading shows
 * the global caps (code defaults until AI-276), the project's own, the effective ones and what
 * was spent today and this month. Writing a project's caps is the owner's project-settings rule
 * and goes through `ProjectService.update`, so a cap above global is refused (422) and every
 * change is a ConfigChange, revertable from the change log. Nothing here spends money.
 */

/** What the settings read from the spend ledger (AI-234: M10.2). */
export type SpendTotalsReader = Pick<SpendLedger, "totals" | "totalsByProvider">;

function log(severity: "WARNING", message: string, fields: object) {
  console.log(JSON.stringify({ severity, message, component: "spend", ...fields }));
}

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };
const ProjectParams = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/) });

export const SpendSettings = z
  .object({
    global: z.object({
      caps: SpendCaps,
      /** `default`: nothing stored yet (the code defaults); `stored`: set by the owner (AI-276). */
      source: z.enum(["default", "stored"]),
      updatedAt: z.string().nullable(),
    }),
    project: ProjectSpendCaps,
    effective: EffectiveSpendCaps,
    spent: SpendSoFar.nullable(),
  })
  .openapi("SpendSettings");

export const SetSpendCaps = z
  .object({
    /** The project's own caps in micro-dollars: a field left out stays as it is; null takes the global cap. */
    caps: ProjectSpendCaps,
    reason: z.string().max(500).optional(),
  })
  .strict()
  .openapi("SetSpendCaps");

const routes = {
  get: createRoute({
    ...secured,
    method: "get",
    path: "/api/projects/{projectId}/spend",
    request: { params: ProjectParams },
    responses: {
      200: json(SpendSettings, "Caps and what was spent today and this month (null: unknown)"),
      404: json(ErrorBody, "Unknown project"),
    },
  }),
  set: createRoute({
    ...secured,
    method: "put",
    path: "/api/projects/{projectId}/spend-caps",
    request: {
      params: ProjectParams,
      body: { content: { "application/json": { schema: SetSpendCaps } }, required: true },
    },
    responses: {
      200: json(SpendSettings, "Stored and logged as a ConfigChange"),
      403: json(ErrorBody, "Only the owner changes project settings"),
      404: json(ErrorBody, "Unknown project"),
      422: json(ErrorBody, "A cap above the global cap"),
    },
  }),
};

/** Spend per provider for a project and for all projects; null: the ledger can't be read. */
export interface SpendByProviderView {
  project: ProviderSpendTotals[] | null;
  global: ProviderSpendTotals[] | null;
}

export class SpendSettingsService {
  constructor(
    private readonly projects: ProjectService,
    private readonly read: (projectId: string) => Promise<ProjectSpendCaps | null>,
    private readonly ledger: SpendTotalsReader | null,
    private readonly now: () => Date,
    private readonly global: GlobalSpendCaps,
  ) {}

  /** Throws when the global caps can't be read: never shown as the defaults (fail closed). */
  async view(projectId: string): Promise<SpendView> {
    const own = await this.read(projectId);
    if (own === null) throw notFound("project", projectId);
    return spendView(own, await this.spent(projectId), await this.global.read());
  }

  async set(
    projectId: string,
    input: z.infer<typeof SetSpendCaps>,
    by: { actor: EventActor; email: string },
  ): Promise<SpendView> {
    const current = await this.read(projectId);
    if (current === null) throw notFound("project", projectId);
    // A field left out stays as it is; null takes the global cap. So setting one cap never
    // clears the others. Read, then write: two concurrent sets can each keep only their own cap
    // (the later write wins). Accepted: only the owner writes, and the change log shows both.
    const given = Object.fromEntries(
      Object.entries(input.caps).filter(([, v]) => v !== undefined),
    ) as ProjectSpendCaps;
    const project = await this.projects.update(
      projectId,
      { spendCaps: { ...current, ...given } },
      by,
      input.reason,
    );
    return spendView(project.spendCaps, await this.spent(projectId), await this.global.read());
  }

  /**
   * Spend per provider today and this month, for the project and for all projects (AI-280's
   * totals): the Spend panel's `GET …/spend/providers` and MCP `get_spend` read it here (AI-288).
   * Null (unknown, never zero) when the ledger can't be read. Two bounded reads (ADR-0126).
   */
  async byProvider(projectId: string): Promise<SpendByProviderView> {
    if ((await this.read(projectId)) === null) throw notFound("project", projectId);
    if (!this.ledger) return { project: null, global: null };
    const at = this.now().toISOString();
    try {
      const [project, global] = await Promise.all([
        this.ledger.totalsByProvider({ projectId }, at),
        this.ledger.totalsByProvider({}, at),
      ]);
      return { project, global };
    } catch (err) {
      log("WARNING", "spend by provider unreadable", { projectId, error: String(err) });
      return { project: null, global: null };
    }
  }

  /** Today's and this month's totals; null (unknown, never zero) when the ledger can't be read. */
  private async spent(projectId: string): Promise<SpendSoFar | null> {
    if (!this.ledger) return null;
    const at = this.now().toISOString();
    try {
      const [project, global] = await Promise.all([
        this.ledger.totals({ projectId }, at),
        this.ledger.totals({}, at),
      ]);
      return SpendSoFar.parse({
        project: { dayMicroUsd: project.dayMicroUsd, monthMicroUsd: project.monthMicroUsd },
        global: { dayMicroUsd: global.dayMicroUsd, monthMicroUsd: global.monthMicroUsd },
      });
    } catch (err) {
      log("WARNING", "spend totals unreadable", { projectId, error: String(err) });
      return null;
    }
  }
}

export function registerSpendRoutes(app: OpenAPIHono<AuthEnv>, spend: SpendSettingsService): void {
  app.openapi(routes.get, async (c) =>
    c.json(await spend.view(c.req.valid("param").projectId), 200),
  );

  app.openapi(routes.set, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(
      await spend.set(projectId, c.req.valid("json"), signedIn(c.get("identity"))),
      200,
    );
  });
}

// ── Global spend caps (AI-276) ───────────────────────────────────────────────
// Owner-only (`change_spend_caps`); cross-project routes, listed in `project-access.ts`.

export const GlobalSpendCapsView = z
  .object({
    caps: SpendCaps,
    source: z.enum(["default", "stored"]),
    /** Pass back as `ifUpdatedAt` to save; null while the defaults are in force. */
    updatedAt: z.string().nullable(),
  })
  .openapi("GlobalSpendCaps");

export const SetGlobalSpendCaps = z
  .object({
    caps: SpendCaps,
    /** The `updatedAt` read with the caps (null for the defaults); a save since is a 409. */
    ifUpdatedAt: z.string().nullable(),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .openapi("SetGlobalSpendCaps");

const ChangeParams = z.object({ changeId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(CONFIG_CHANGE_LIST_MAX).optional(),
});

const globalRoutes = {
  get: createRoute({
    ...secured,
    method: "get",
    path: "/api/spend-caps",
    responses: {
      200: json(GlobalSpendCapsView, "The global caps: stored, or the code defaults"),
    },
  }),
  set: createRoute({
    ...secured,
    method: "put",
    path: "/api/spend-caps",
    request: {
      body: { content: { "application/json": { schema: SetGlobalSpendCaps } }, required: true },
    },
    responses: {
      200: json(GlobalSpendCapsView, "Stored and logged as a global ConfigChange"),
      403: json(ErrorBody, "Only the owner changes the global spend caps"),
      409: json(ErrorBody, "Saved by someone else since they were read: read again"),
      422: json(ErrorBody, "No spend caps store is configured"),
    },
  }),
  changes: createRoute({
    ...secured,
    method: "get",
    path: "/api/spend-caps/changes",
    request: { query: ListQuery },
    responses: {
      200: json(z.array(ConfigChange), "The global caps' changes, newest first (capped)"),
      403: json(ErrorBody, "Only the owner reads the global caps' log"),
    },
  }),
  revert: createRoute({
    ...secured,
    method: "post",
    path: "/api/spend-caps/changes/{changeId}/revert",
    request: { params: ChangeParams },
    responses: {
      200: json(
        z.object({ global: GlobalSpendCapsView, reverted: ConfigChange }),
        "Before values saved (logged as a new change); original reverted",
      ),
      403: json(ErrorBody, "Only the owner changes the global spend caps"),
      404: json(ErrorBody, "Unknown change"),
      409: json(ErrorBody, "Not revertible: not applied, or a cap changed since"),
    },
  }),
};

export function registerGlobalSpendCapsRoutes(
  app: OpenAPIHono<AuthEnv>,
  global: GlobalSpendCaps,
): void {
  app.openapi(globalRoutes.get, async (c) => c.json(await global.read(), 200));

  app.openapi(globalRoutes.set, async (c) => {
    const { caps, ifUpdatedAt, reason } = c.req.valid("json");
    return c.json(await global.put(caps, ifUpdatedAt, actorOf(c.get("identity")), reason), 200);
  });

  app.openapi(globalRoutes.changes, async (c) =>
    c.json(await global.changeLog(actorOf(c.get("identity")), c.req.valid("query").limit), 200),
  );

  app.openapi(globalRoutes.revert, async (c) =>
    c.json(await global.revert(c.req.valid("param").changeId, actorOf(c.get("identity"))), 200),
  );
}

/** Listed in `api-routes.ts` (AI-145). */
export const apiRoutes: RouteModule = (app, s) => {
  registerSpendRoutes(app, s.spend);
  registerGlobalSpendCapsRoutes(app, s.globalSpendCaps);
};
