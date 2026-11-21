import {
  CONFIG_CHANGE_LIST_MAX,
  notFound,
  WorkTrackerError,
  type ConfigChange,
  type ConfigChangeLog,
  type EventActor,
  type Project,
  type WorkTracker,
} from "@andy/contracts";
import { revertPatch, revertReason, revertRefusal } from "./config-changes";
import { DomainError } from "./errors";
import { effectiveMergeMode, requireTightening } from "./merge-mode";
import { requireCan } from "./permissions";
import type { ProjectService } from "./projects";
import type { RoutingSettings } from "./routing-settings";

function log(severity: "INFO" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "config-revert", ...fields }));
}

/** Where a revert came from: Builds (`buildEnabled`) is set only in the app (ADR-0063). */
export type RevertVia = "app" | "mcp";

export interface RevertResult {
  /** The project with the change's before values back. */
  project: Project;
  /** The original change, now `reverted`. */
  reverted: ConfigChange;
}

/**
 * A project's settings change log, read and reverted (M4.12: Config audit log and revert). The
 * same rules for the REST routes, the settings page and MCP. Reverting is the owner's
 * project-settings rule (`change_project_settings`, AI-19): it writes the change's before values
 * through `ProjectService.update`, so the revert is itself logged, then marks the original
 * `reverted`. Refused when a field changed since (naming the newer change).
 */
export class ConfigRevert {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly projects: ProjectService,
    private readonly changes: ConfigChangeLog,
    private readonly now: () => Date = () => new Date(),
    /** Routing changes in the project's log revert through routing settings (AI-275). */
    private readonly routing: Pick<RoutingSettings, "revert"> | null = null,
  ) {}

  /** The project's changes, newest first, at most `limit` (capped, ADR-0028). */
  async list(projectId: string, limit = CONFIG_CHANGE_LIST_MAX): Promise<ConfigChange[]> {
    if (!(await this.tracker.getProject(projectId))) throw notFound("project", projectId);
    return this.changes.listForProject(projectId, limit);
  }

  async revert(
    projectId: string,
    changeId: string,
    by: { actor: EventActor; email: string },
    via: RevertVia,
  ): Promise<RevertResult> {
    requireCan(by.actor, "change_project_settings", projectId);
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const change = await this.changes.get(changeId);
    // A routing change (AI-239) shows in its project's log but isn't settings: it reverts through
    // routing settings (AI-275), never by replaying its diff as settings.
    if (change?.entity === "routing" && change.projectId === projectId) {
      if (!this.routing) {
        throw new DomainError("not_revertible", `config change ${change.id} is a routing change`, [
          "routing isn't configured here",
        ]);
      }
      const { reverted } = await this.routing.revert(change.id, by.actor);
      return { project, reverted };
    }
    if (!change || change.entity !== "project" || change.entityId !== projectId) {
      throw notFound("config change", changeId);
    }
    const patch = revertPatch(change);
    if (via === "mcp" && "buildEnabled" in patch) {
      throw new DomainError("not_revertible", `config change ${change.id} switches Builds`, [
        "Builds is set only in the app: revert it on the settings page",
      ]);
    }
    // ADR-0124: over MCP a merge mode may only tighten; a revert that loosens it is refused.
    if (via === "mcp" && "mergeMode" in patch) {
      const target = effectiveMergeMode({ ...project, mergeMode: patch.mergeMode ?? null });
      requireTightening(target, project);
    }
    const logged = await this.changes.listForProject(projectId, CONFIG_CHANGE_LIST_MAX);
    // A revert whose write was logged but whose mark failed: finish it, don't write again. Only a
    // later applied settings change by the owner with exactly the revert's reason counts.
    const done = logged.some(
      (c) =>
        c.reason === revertReason(change.id) &&
        c.entity === "project" &&
        c.actor === "andy" &&
        (c.status === "applied" || c.status === "reverted") &&
        c.createdAt >= change.createdAt,
    );
    if (done) {
      const reverted = await this.mark(change, by.actor);
      log("INFO", "config change revert completed", { projectId, configChangeId: change.id });
      return { project, reverted };
    }
    const refusal = revertRefusal(change, project, logged);
    if (refusal) throw refusal;

    // Two reverts at once can both write the same before values (both logged); only one marks.
    const updated = await this.projects.update(projectId, patch, by, revertReason(change.id));
    const reverted = await this.mark(change, by.actor);
    log("INFO", "config change reverted", {
      projectId,
      configChangeId: change.id,
      fields: Object.keys(patch),
      by: by.actor,
      via,
    });
    return { project: updated, reverted };
  }

  /**
   * Marks the original reverted. A `conflict` means another revert marked it first: a 409 for
   * this caller, not an error. Anything else logs an ERROR (the settings are back and logged;
   * a retry finishes the mark) and surfaces.
   */
  private async mark(change: ConfigChange, by: EventActor): Promise<ConfigChange> {
    try {
      return await this.changes.markReverted(change.id, by, this.now().toISOString());
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "conflict") {
        throw new DomainError("not_revertible", `config change ${change.id} is already reverted`);
      }
      log("ERROR", "config change not marked reverted", {
        projectId: change.entityId,
        configChangeId: change.id,
        by,
        error: String(err),
      });
      throw err;
    }
  }
}
