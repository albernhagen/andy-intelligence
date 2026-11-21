import {
  ConfigChange,
  ProjectSettings,
  type Actor,
  type EventActor,
  type Project,
} from "@andy/contracts";
import { DomainError } from "./errors";

/**
 * Config change log (M4.11, `domain-and-ports.md` §5): every project-settings write is a
 * ConfigChange. Pure rules; `ProjectService.update` appends what `projectSettingsChange` returns.
 */

/**
 * The ERROR log message when a settings write's ConfigChange isn't recorded (`component:
 * "projects"`). Stable: the log-based alert (AI-136) matches it, so don't reword it.
 */
export const CONFIG_CHANGE_NOT_RECORDED = "config change not recorded";

/** Before and after of each changed field. */
export type SettingsDiff = Record<string, { from: unknown; to: unknown }>;

/** The project's settings (ProjectSettings fields), compared by value. */
const SETTINGS_FIELDS = Object.keys(ProjectSettings.shape) as (keyof ProjectSettings)[];

/**
 * The settings fields that differ between `before` and `after`, including ones the write changed
 * on its own (builds off turns `autoBuild` off). Who and when (`buildEnabledBy`, `buildEnabledAt`)
 * are the change's own actor and time, so they are left out.
 */
export function settingsDiff(before: Project, after: Project): SettingsDiff {
  const diff: SettingsDiff = {};
  for (const field of SETTINGS_FIELDS) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (!sameValue(from, to)) diff[field] = { from, to };
  }
  return diff;
}

/** The ConfigChange actor for a ticket-event actor: an agent, or Andy (owner-only settings). */
export function changeActor(actor: EventActor): Actor {
  return actor.startsWith("agent:") ? "agent" : "andy";
}

/** An `applied` change for a settings write, or null when the write changed nothing. */
export function projectSettingsChange(input: {
  id: string;
  before: Project;
  after: Project;
  actor: EventActor;
  reason?: string;
  at: Date;
}): ConfigChange | null {
  const diff = settingsDiff(input.before, input.after);
  if (Object.keys(diff).length === 0) return null;
  const at = input.at.toISOString();
  return ConfigChange.parse({
    id: input.id,
    entity: "project",
    entityId: input.after.id,
    projectId: input.after.id,
    diff,
    actor: changeActor(input.actor),
    reason: input.reason?.trim() ?? "",
    status: "applied",
    createdAt: at,
    appliedAt: at,
  });
}

/** Deep equality for settings values (JSON data: scalars, arrays, plain objects). */
function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)))
      : v,
  );
}

/** The reason a revert's own change carries, so the log links it to the change it undid. */
export const revertReason = (changeId: string) => `Revert of ${changeId}`;

/**
 * The settings write that undoes `change` (M4.12): each changed field back to its `from` value.
 * Refused (`not_revertible`) for anything but an applied project-settings change, or one whose
 * values aren't valid settings any more.
 */
export function revertPatch(change: ConfigChange): ProjectSettings {
  if (change.entity !== "project") {
    throw new DomainError("not_revertible", `config change ${change.id} isn't a settings change`);
  }
  if (change.status !== "applied") {
    throw new DomainError("not_revertible", `config change ${change.id} is ${change.status}`, [
      "only an applied change can be reverted",
    ]);
  }
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(change.diff)) {
    patch[field] = (value as { from?: unknown } | null)?.from;
  }
  const parsed = ProjectSettings.safeParse(patch);
  if (!parsed.success || Object.keys(patch).length === 0) {
    throw new DomainError("not_revertible", `config change ${change.id} can't be reverted`, [
      "its before values aren't valid settings",
    ]);
  }
  return parsed.data;
}

/**
 * Why `change` can't be reverted because its settings moved on, or null when it can (M4.12):
 * a newer logged change touched one of its fields (named, newest first), or a field no longer
 * holds the change's `to` value (a write outside the log, e.g. one whose append failed).
 * `logged` is the project's log, any order; changes older than `change` are ignored.
 */
export function revertRefusal(
  change: ConfigChange,
  current: Project,
  logged: ConfigChange[],
): DomainError | null {
  const fields = Object.keys(change.diff);
  const newer = logged
    // A change in the same millisecond counts as newer: the log can't order them, so refuse.
    .filter((c) => c.id !== change.id && c.createdAt >= change.createdAt)
    .filter((c) => Object.keys(c.diff).some((f) => fields.includes(f)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = newer[0];
  if (latest) {
    const touched = Object.keys(latest.diff).filter((f) => fields.includes(f));
    return new DomainError(
      "not_revertible",
      `${touched.join(", ")} changed since, by config change ${latest.id} at ${latest.createdAt}`,
      ["revert the newer change first, or change the setting directly"],
    );
  }
  const stale = fields.filter((f) => {
    const to = (change.diff[f] as { to?: unknown } | null)?.to ?? null;
    return !sameValue(current[f as keyof Project] ?? null, to);
  });
  if (stale.length > 0) {
    return new DomainError(
      "not_revertible",
      `${stale.join(", ")} changed since, by a write not in the change log`,
      ["change the setting directly"],
    );
  }
  return null;
}
