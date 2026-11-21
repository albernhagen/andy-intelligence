import {
  ConfigChange,
  Milestone,
  MilestoneCapError,
  WorkTrackerError,
  milestoneTargetProblem,
  notFound,
  type ConfigChangeLog,
  type EventActor,
  type MilestoneStatus,
  type MilestoneStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { CONFIG_CHANGE_NOT_RECORDED, changeActor, revertReason } from "./config-changes";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";

/**
 * Milestones (ADR-0131, AI-304: M4.34): one rule for the API and MCP. Reads are open to anyone
 * who can read the project; every write is the owner's (`change_milestones`) and goes in the
 * config change log as entity `milestone`, so it shows in the project's change log and can be
 * reverted there. A milestone holds top-level epics; attaching checks the epic
 * (`milestoneTargetProblem`) and that the milestone is in the same project. Agent tasks get no
 * milestone tools.
 */

export const MILESTONE_ENTITY = "milestone";

/** The milestone fields a change can set. */
const FIELDS = ["name", "outcome", "order", "status"] as const;
type Field = (typeof FIELDS)[number];

export interface NewMilestone {
  name: string;
  outcome: string;
  /** Position on the roadmap; default: after the last one. */
  order?: number;
}

export type MilestonePatch = Partial<{
  name: string;
  outcome: string;
  order: number;
  status: MilestoneStatus;
}>;

type Diff = Record<string, { from: unknown; to: unknown }>;

function log(severity: "INFO" | "ERROR", message: string, fields: object) {
  console.log(JSON.stringify({ severity, message, component: "milestones", ...fields }));
}

export class MilestoneService {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly store: MilestoneStore,
    private readonly changes: ConfigChangeLog | null,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** The project's milestones in roadmap order. Bounded by MILESTONES_PER_PROJECT_MAX. */
  async list(projectId: string): Promise<Milestone[]> {
    await this.requireProject(projectId);
    return this.store.list(projectId);
  }

  async create(
    projectId: string,
    input: NewMilestone,
    actor: EventActor,
    reason?: string,
  ): Promise<Milestone> {
    requireCan(actor, "change_milestones", projectId);
    await this.requireProject(projectId);
    const existing = await this.store.list(projectId);
    const order = input.order ?? existing.reduce((max, m) => Math.max(max, m.order + 1), 0);
    const at = this.now().toISOString();
    let created: Milestone;
    try {
      created = await this.store.create(
        Milestone.parse({
          id: this.newId()
            .replace(/[^A-Za-z0-9_-]/g, "")
            .slice(0, 64),
          projectId,
          name: input.name,
          outcome: input.outcome,
          order,
          status: "not_reviewed",
          createdAt: at,
          updatedAt: at,
        }),
      );
    } catch (err) {
      if (err instanceof MilestoneCapError) {
        throw new DomainError("invalid_field", err.message, ["cap: MILESTONES_PER_PROJECT_MAX"]);
      }
      throw err;
    }
    const diff: Diff = {
      created: {
        from: null,
        to: { name: created.name, outcome: created.outcome, order, status: created.status },
      },
    };
    await this.record(projectId, created.id, diff, actor, reason);
    return created;
  }

  /**
   * Renames, rewords, reorders or sets the status of a milestone. Nothing changed: nothing logged.
   * `ifUpdatedAt`: the version the caller validated (a revert); a `conflict` if it moved since.
   */
  async update(
    projectId: string,
    milestoneId: string,
    patch: MilestonePatch,
    actor: EventActor,
    reason?: string,
    ifUpdatedAt?: string,
  ): Promise<Milestone> {
    requireCan(actor, "change_milestones", projectId);
    await this.requireProject(projectId);
    const current = await this.requireMilestone(projectId, milestoneId);
    if (ifUpdatedAt !== undefined && current.updatedAt !== ifUpdatedAt) {
      throw movedSince("milestone", milestoneId);
    }
    const diff: Diff = {};
    for (const field of FIELDS) {
      const to = patch[field];
      if (to !== undefined && to !== current[field]) diff[field] = { from: current[field], to };
    }
    if (Object.keys(diff).length === 0) return current;
    const next = Milestone.parse({
      ...current,
      ...Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to])),
      updatedAt: laterThan(current.updatedAt, this.now()),
    });
    // Only if unchanged since the read: a concurrent write is a 409, never silently overwritten.
    const stored = await this.store.replace(next, current.updatedAt);
    if (!stored) throw notFound("milestone", milestoneId);
    await this.record(projectId, milestoneId, diff, actor, reason);
    return stored;
  }

  /**
   * Attaches a top-level epic to a milestone of the same project, or detaches it (`null`). The
   * epic is named by key (`AI-84`) or id. Its child epics and tickets take its milestone.
   * `ifUpdatedAt`: the epic version the caller validated (a revert); a `conflict` if it moved since.
   */
  async setEpicMilestone(
    projectId: string,
    epicRef: string,
    milestoneId: string | null,
    actor: EventActor,
    reason?: string,
    ifUpdatedAt?: string,
  ): Promise<Ticket> {
    requireCan(actor, "change_milestones", projectId);
    await this.requireProject(projectId);
    const epic =
      (await this.tracker.getTicketByKey(projectId, epicRef.toUpperCase())) ??
      (await this.tracker.getTicket(projectId, epicRef));
    if (!epic) throw notFound("ticket", epicRef);
    if (ifUpdatedAt !== undefined && epic.updatedAt !== ifUpdatedAt) {
      throw movedSince("ticket", epic.key);
    }
    if (milestoneId !== null) {
      const problem = milestoneTargetProblem(epic);
      if (problem) throw new DomainError("invalid_field", problem);
      // The milestone must exist in this project (AI-302's review): never another project's.
      await this.requireMilestone(projectId, milestoneId);
    }
    const from = epic.milestoneId ?? null;
    if (from === milestoneId) return epic;
    const updated = await this.tracker.updateTicket(
      projectId,
      epic.id,
      { fields: { milestoneId }, ifUpdatedAt: epic.updatedAt },
      actor,
    );
    await this.record(
      projectId,
      epic.id,
      { milestoneId: { from, to: milestoneId } },
      actor,
      reason,
    );
    return updated;
  }

  /**
   * Reverts one applied milestone change: each field goes back to its before value through the
   * normal write (validated, logged as a new change), then the original is marked reverted.
   * Refused when the milestone or epic no longer holds the change's values (a later change), for
   * a creation (milestones aren't deleted: park one instead), and for a diff it can't fully undo.
   * The write is conditional on the version this check read, so a concurrent edit or revert makes
   * it a conflict before anything is written, never a silent undo.
   */
  async revert(
    change: ConfigChange,
    actor: EventActor,
  ): Promise<{ reverted: ConfigChange; milestone?: Milestone; epic?: Ticket }> {
    const projectId = change.projectId;
    if (change.entity !== MILESTONE_ENTITY || !projectId) {
      throw notFound("config change", change.id);
    }
    requireCan(actor, "change_milestones", projectId);
    if (change.status !== "applied") {
      throw new DomainError("not_revertible", `config change ${change.id} is ${change.status}`, [
        "only an applied change can be reverted",
      ]);
    }
    const diff = change.diff as Diff;
    const reason = revertReason(change.id);
    if ("created" in diff) {
      throw new DomainError("not_revertible", `config change ${change.id} created a milestone`, [
        "milestones aren't deleted: park it instead",
      ]);
    }
    if ("milestoneId" in diff) {
      const epic = await this.tracker.getTicket(projectId, change.entityId);
      if (!epic) throw notFound("ticket", change.entityId);
      if ((epic.milestoneId ?? null) !== diff.milestoneId!.to) {
        throw changedSince(change);
      }
      const restored = await this.setEpicMilestone(
        projectId,
        epic.id,
        (diff.milestoneId!.from as string | null) ?? null,
        actor,
        reason,
        epic.updatedAt,
      );
      return { reverted: await this.markReverted(change, actor), epic: restored };
    }
    const current = await this.requireMilestone(projectId, change.entityId);
    const fields = Object.keys(diff).filter((k): k is Field => FIELDS.includes(k as Field));
    // A diff this code can't fully undo (empty, or a field it doesn't know) is never marked reverted.
    if (fields.length === 0 || fields.length !== Object.keys(diff).length) {
      throw new DomainError("not_revertible", `config change ${change.id} can't be reverted here`, [
        "its diff holds no milestone field this version can restore",
      ]);
    }
    if (fields.some((f) => current[f] !== diff[f]!.to)) throw changedSince(change);
    const patch = Object.fromEntries(fields.map((f) => [f, diff[f]!.from])) as MilestonePatch;
    // Written only against the version checked above: a change in between is a conflict.
    const milestone = await this.update(
      projectId,
      current.id,
      patch,
      actor,
      reason,
      current.updatedAt,
    );
    return { reverted: await this.markReverted(change, actor), milestone };
  }

  /**
   * Appends the write's ConfigChange. The write is already stored, so nothing here fails it: a
   * failure logs the ERROR the config-change alert matches (AI-136).
   */
  private async record(
    projectId: string,
    entityId: string,
    diff: Diff,
    actor: EventActor,
    reason: string | undefined,
  ): Promise<void> {
    if (!this.changes) return;
    const at = this.now().toISOString();
    const id = this.newId();
    try {
      await this.changes.append(
        ConfigChange.parse({
          id,
          entity: MILESTONE_ENTITY,
          entityId,
          projectId,
          diff,
          actor: changeActor(actor),
          reason: reason?.trim() ?? "",
          status: "applied",
          createdAt: at,
          appliedAt: at,
        }),
      );
      log("INFO", "milestone changed", {
        projectId,
        configChangeId: id,
        fields: Object.keys(diff),
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

  private async markReverted(change: ConfigChange, actor: EventActor): Promise<ConfigChange> {
    if (!this.changes) {
      throw new DomainError("not_revertible", "the config change log isn't configured");
    }
    try {
      return await this.changes.markReverted(change.id, actor, this.now().toISOString());
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "conflict") {
        throw new DomainError("not_revertible", `config change ${change.id} is already reverted`);
      }
      throw err;
    }
  }

  private async requireProject(projectId: string): Promise<void> {
    if (!(await this.tracker.getProject(projectId))) throw notFound("project", projectId);
  }

  private async requireMilestone(projectId: string, milestoneId: string): Promise<Milestone> {
    const found = await this.store.get(projectId, milestoneId);
    if (!found) throw notFound("milestone", milestoneId);
    return found;
  }
}

/**
 * `updatedAt` for a write: now, but always after the read's, so two writes in one millisecond
 * still differ and the second's `ifUpdatedAt` check sees the first.
 */
function laterThan(previous: string, now: Date): string {
  const floor = Date.parse(previous) + 1;
  return new Date(Math.max(now.getTime(), floor)).toISOString();
}

const movedSince = (what: string, id: string) =>
  new WorkTrackerError("conflict", `${what} ${id} changed since it was read`);

const changedSince = (change: ConfigChange) =>
  new DomainError("not_revertible", `config change ${change.id} was changed since`, [
    "a later change set these values: revert that one first",
  ]);
