import {
  ConfigChange,
  ProjectSettings,
  type Actor,
  type EventActor,
  type Project,
} from "@andy/contracts";

/**
 * Config change log (M4.11, `domain-and-ports.md` §5): every project-settings write is a
 * ConfigChange. Pure rules; `ProjectService.update` appends what `projectSettingsChange` returns.
 */

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
