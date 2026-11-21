import {
  CONFIG_CHANGE_LIST_MAX,
  notFound,
  type ConfigChange,
  type ConfigChangeLog,
  type EventActor,
  type Project,
  type WorkTracker,
} from "@andy/contracts";
import { revertPatch, revertReason, revertRefusal } from "./config-changes";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";
import type { ProjectService } from "./projects";

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
    if (!change || change.entity !== "project" || change.entityId !== projectId) {
      throw notFound("config change", changeId);
    }
    const patch = revertPatch(change);
    if (via === "mcp" && "buildEnabled" in patch) {
      throw new DomainError("not_revertible", `config change ${change.id} switches Builds`, [
        "Builds is set only in the app: revert it on the settings page",
      ]);
    }
    const refusal = revertRefusal(
      change,
      project,
      await this.changes.listForProject(projectId, CONFIG_CHANGE_LIST_MAX),
    );
    if (refusal) throw refusal;

    const updated = await this.projects.update(projectId, patch, by, revertReason(change.id));
    let reverted: ConfigChange;
    try {
      reverted = await this.changes.markReverted(change.id, by.actor, this.now().toISOString());
    } catch (err) {
      // The settings are back and the revert is logged as its own change; only the mark failed.
      log("ERROR", "config change not marked reverted", {
        projectId,
        configChangeId: change.id,
        by: by.actor,
        error: String(err),
      });
      throw err;
    }
    log("INFO", "config change reverted", {
      projectId,
      configChangeId: change.id,
      fields: Object.keys(patch),
      by: by.actor,
      via,
    });
    return { project: updated, reverted };
  }
}
