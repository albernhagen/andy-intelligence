import {
  ConfigChange,
  ProviderKey,
  RoutingConfigInput,
  notFound,
  type ConfigChangeLog,
  type EventActor,
  type ProviderRouting,
  type Route,
  type RunStep,
  type StepTier,
  type RoutingConfig,
  type RoutingConfigStore,
  type TierKey,
  type WorkTracker,
} from "@andy/contracts";
import { CONFIG_CHANGE_NOT_RECORDED, changeActor, type SettingsDiff } from "./config-changes";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";
import { routeProblem } from "./routing-rules";

/**
 * Routing settings (AI-239: M9.7): read and edit the global and per-project routing config for
 * the REST routes and MCP alike. Every save is owner-only (`change_routing`), every route must
 * pass `routeProblem` (AI-231: M9.4), and a project config may only narrow global. Each accepted
 * save appends one ConfigChange (entity `routing`), so it is audited with who changed what.
 */

function log(severity: "INFO" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "routing-settings", ...fields }));
}

/** The editable part of a config: what a save sends. */
export type RoutingFields = Pick<RoutingConfig, "providers" | "tiers" | "steps">;

/** A project's routing: its own config (null when it follows global) and what applies. */
export interface ProjectRouting {
  projectId: string;
  config: RoutingConfig | null;
  /** The project's config when it has one, else global; narrowing is checked on save. */
  effective: RoutingConfig;
}

const FIELDS = ["providers", "tiers", "steps"] as const;

/** Projects one routing overview reads (ADR-0028); past it the view says it was cut short. */
export const ROUTING_VIEW_MAX_PROJECTS = 50;

export class RoutingSettings {
  constructor(
    private readonly store: RoutingConfigStore,
    private readonly tracker: Pick<WorkTracker, "getProject">,
    private readonly changes: ConfigChangeLog | null,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async global(): Promise<RoutingConfig> {
    return this.store.getGlobal();
  }

  /**
   * Global and the routing of each of `projectIds` (at most ROUTING_VIEW_MAX_PROJECTS, ADR-0028):
   * global is read once, then one config read per project. `truncated` when ids were dropped.
   */
  async overview(
    projectIds: string[],
  ): Promise<{ global: RoutingConfig; projects: ProjectRouting[]; truncated: boolean }> {
    const ids = projectIds.slice(0, ROUTING_VIEW_MAX_PROJECTS);
    const [global, configs] = await Promise.all([
      this.store.getGlobal(),
      Promise.all(ids.map((id) => this.store.getProject(id))),
    ]);
    return {
      global,
      projects: ids.map((projectId, i) => {
        const config = configs[i] ?? null;
        return { projectId, config, effective: config ?? global };
      }),
      truncated: projectIds.length > ids.length,
    };
  }

  async project(projectId: string): Promise<ProjectRouting> {
    await this.requireProject(projectId);
    const [global, config] = await Promise.all([
      this.store.getGlobal(),
      this.store.getProject(projectId),
    ]);
    return { projectId, config, effective: config ?? global };
  }

  /** Saves the global config. `ifUpdatedAt` is the `updatedAt` read (null: never stored). */
  async putGlobal(
    fields: RoutingFields,
    ifUpdatedAt: string | null,
    actor: EventActor,
    reason?: string,
  ): Promise<RoutingConfig> {
    requireCan(actor, "change_routing", null);
    const input = this.input(null, fields);
    const before = await this.store.getGlobal();
    const saved = await this.store.put(input, ifUpdatedAt);
    await this.record(null, before, saved, actor, reason);
    return saved;
  }

  /**
   * Saves a project's config; refused unless every part of it narrows global. The check reads
   * global outside the store's write, so a global save in between can leave a stored project
   * config wider than global: the route resolver (AI-238: M9.6) narrows to the current global
   * at run time, so a wider stored config never widens what runs.
   */
  async putProject(
    projectId: string,
    fields: RoutingFields,
    ifUpdatedAt: string | null,
    actor: EventActor,
    reason?: string,
  ): Promise<RoutingConfig> {
    requireCan(actor, "change_routing", projectId);
    await this.requireProject(projectId);
    const input = this.input(projectId, fields);
    const [global, before] = await Promise.all([
      this.store.getGlobal(),
      this.store.getProject(projectId),
    ]);
    const wider = widerThanGlobal(input, global);
    if (wider.length > 0) {
      throw new DomainError("invalid_field", "a project's routing may only narrow global", wider);
    }
    const saved = await this.store.put(input, ifUpdatedAt);
    await this.record(projectId, before, saved, actor, reason);
    return saved;
  }

  /** Replaces one tier's routes, global (`projectId` null) or a project's. */
  async setTierRoutes(
    projectId: string | null,
    tier: TierKey,
    routes: Route[],
    actor: EventActor,
    reason?: string,
  ): Promise<RoutingConfig> {
    return this.edit(projectId, actor, reason, (f) => ({
      ...f,
      tiers: { ...f.tiers, [tier]: routes },
    }));
  }

  /** Sets one provider's switch and levels, global or a project's. */
  async setProvider(
    projectId: string | null,
    provider: ProviderKey,
    settings: ProviderRouting,
    actor: EventActor,
    reason?: string,
  ): Promise<RoutingConfig> {
    return this.edit(projectId, actor, reason, (f) => ({
      ...f,
      providers: { ...f.providers, [provider]: settings },
    }));
  }

  /** Sets which tier one step uses, global or a project's. */
  async setStepTier(
    projectId: string | null,
    step: RunStep,
    tier: StepTier,
    actor: EventActor,
    reason?: string,
  ): Promise<RoutingConfig> {
    return this.edit(projectId, actor, reason, (f) => ({
      ...f,
      steps: { ...f.steps, [step]: tier },
    }));
  }

  /**
   * One change to global (`projectId` null) or a project's config (starting from global when it
   * has none), saved against what was read, so a concurrent save is a conflict.
   */
  private async edit(
    projectId: string | null,
    actor: EventActor,
    reason: string | undefined,
    change: (fields: RoutingFields) => RoutingFields,
  ): Promise<RoutingConfig> {
    requireCan(actor, "change_routing", projectId);
    if (projectId === null) {
      const current = await this.store.getGlobal();
      return this.putGlobal(change(pick(current)), current.updatedAt, actor, reason);
    }
    const { config, effective } = await this.project(projectId);
    return this.putProject(
      projectId,
      change(pick(effective)),
      config?.updatedAt ?? null,
      actor,
      reason,
    );
  }

  /** The config to store, checked: its shape, then every route's compatibility. */
  private input(projectId: string | null, fields: RoutingFields): RoutingConfigInput {
    const parsed = RoutingConfigInput.safeParse({
      scope: projectId === null ? "global" : "project",
      projectId,
      ...fields,
    });
    if (!parsed.success) {
      throw new DomainError(
        "invalid_field",
        "the routing config isn't valid",
        parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`),
      );
    }
    const problems = Object.entries(parsed.data.tiers).flatMap(([tier, routes]) =>
      routes.flatMap((route, i) => {
        const problem = routeProblem(route);
        return problem ? [`tier ${tier}, route ${i + 1}: ${problem}`] : [];
      }),
    );
    if (problems.length > 0) {
      throw new DomainError("invalid_field", "a route can't run", problems);
    }
    return parsed.data;
  }

  /**
   * Appends the save's ConfigChange. The config is already stored, so nothing here fails the
   * request: a failure logs an ERROR with the diff (the same message the projects alert matches).
   */
  private async record(
    projectId: string | null,
    before: RoutingConfig | null,
    after: RoutingConfig,
    actor: EventActor,
    reason: string | undefined,
  ): Promise<void> {
    const diff = routingDiff(before, after);
    if (!this.changes || Object.keys(diff).length === 0) return;
    const at = this.now().toISOString();
    const id = this.newId();
    try {
      await this.changes.append(
        ConfigChange.parse({
          id,
          entity: "routing",
          entityId: projectId ?? "global",
          projectId,
          diff,
          actor: changeActor(actor),
          reason: reason?.trim() ?? "",
          status: "applied",
          createdAt: at,
          appliedAt: at,
        }),
      );
      log("INFO", "routing changed", {
        projectId,
        configChangeId: id,
        fields: Object.keys(diff),
        by: actor,
      });
    } catch (err) {
      log("ERROR", CONFIG_CHANGE_NOT_RECORDED, {
        projectId,
        configChangeId: id,
        diff,
        by: actor,
        error: String(err),
      });
    }
  }

  private async requireProject(projectId: string): Promise<void> {
    if (!(await this.tracker.getProject(projectId))) throw notFound("project", projectId);
  }
}

const pick = (c: RoutingConfig): RoutingFields => ({
  providers: c.providers,
  tiers: c.tiers,
  steps: c.steps,
});

/** Before and after of each changed part (providers, tiers, steps); `from` null on a first save. */
export function routingDiff(before: RoutingConfig | null, after: RoutingConfig): SettingsDiff {
  const diff: SettingsDiff = {};
  for (const field of FIELDS) {
    const from = before ? before[field] : null;
    if (JSON.stringify(from) !== JSON.stringify(after[field])) {
      diff[field] = { from, to: after[field] };
    }
  }
  return diff;
}

/**
 * How `project` is wider than `global`, one line each; empty when it only narrows. A project may
 * turn a provider off but not on, keep a larger reserve and lower warn and pause levels, a lower
 * daily task limit, and use only routes global lists for the same tier.
 */
export function widerThanGlobal(project: RoutingFields, global: RoutingFields): string[] {
  const problems: string[] = [];
  for (const key of ProviderKey.options) {
    const p = project.providers[key];
    const g = global.providers[key];
    if (p.enabled && !g.enabled) problems.push(`provider ${key} is off globally`);
    if (p.reservePct < g.reservePct) {
      problems.push(`provider ${key}: reserve ${p.reservePct}% is below global ${g.reservePct}%`);
    }
    if (p.warnPct > g.warnPct) {
      problems.push(`provider ${key}: warn at ${p.warnPct}% is above global ${g.warnPct}%`);
    }
    if (p.pausePct > g.pausePct) {
      problems.push(`provider ${key}: pause at ${p.pausePct}% is above global ${g.pausePct}%`);
    }
    if (g.dailyTaskLimit !== null && (p.dailyTaskLimit ?? Infinity) > g.dailyTaskLimit) {
      problems.push(`provider ${key}: daily task limit is above global ${g.dailyTaskLimit}`);
    }
  }
  for (const [tier, routes] of Object.entries(project.tiers) as [TierKey, Route[]][]) {
    const allowed = global.tiers[tier].map((r) => JSON.stringify(r));
    routes.forEach((route, i) => {
      if (!allowed.includes(JSON.stringify(route))) {
        problems.push(
          `tier ${tier}, route ${i + 1}: ${route.harness} on ${route.provider} (${route.model}) isn't a global ${tier} route`,
        );
      }
    });
  }
  return problems;
}
