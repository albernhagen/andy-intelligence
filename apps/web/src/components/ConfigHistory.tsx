import type { ConfigChange } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { errorText } from "@/lib/api";
import { useRevertSettingsChange, useSettingsChanges } from "@/lib/queries";
import { settingLabel, settingValue } from "@/lib/settings-labels";
import { dateTime } from "@/lib/format";

const button =
  "rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 max-sm:min-h-11 max-sm:px-3";

/**
 * The project's settings changes (M4.12), newest first, on the settings page: who, when, what
 * changed (before → after) and why. Revert writes the before values back through the normal
 * settings rules (owner only), logged as a new change; the API refuses it when a field changed
 * since, and the error names the newer change.
 */
export function ConfigHistory({ projectId }: { projectId: string }) {
  const changes = useSettingsChanges(projectId);
  const revert = useRevertSettingsChange(projectId);
  const list = changes.data ?? [];

  return (
    <section aria-label="Changes" className="space-y-2">
      <h3 className="text-sm font-medium">Changes</h3>
      {changes.error && <QueryError error={changes.error} />}
      {revert.error && <p className="text-xs text-destructive">{errorText(revert.error)}</p>}
      {changes.isSuccess && list.length === 0 && (
        <p className="text-xs text-muted-foreground">No settings changes yet.</p>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {list.map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              reverting={revert.isPending}
              onRevert={() => revert.mutate(c.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeRow({
  change,
  reverting,
  onRevert,
}: {
  change: ConfigChange;
  reverting: boolean;
  onRevert: () => void;
}) {
  // A routing change (AI-239) names what it changed; its values are whole routing sections.
  const routing = change.entity === "routing";
  const fields = routing
    ? [`Routing: ${Object.keys(change.diff).join(", ")} changed`]
    : Object.entries(change.diff).map(
        ([field, value]) => `${settingLabel(field)}: ${show(value, "from")} → ${show(value, "to")}`,
      );
  return (
    <li aria-label={`Change ${change.id}`} className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p>{fields.join("; ")}</p>
        <p className="text-xs text-muted-foreground">
          {change.actor === "andy" ? "Andy" : change.actor} · {dateTime(change.createdAt)}
          {change.reason && ` · ${change.reason}`}
        </p>
      </div>
      {change.status === "applied" ? (
        <button type="button" className={button} disabled={reverting} onClick={onRevert}>
          Revert
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">
          {change.status === "reverted" ? "Reverted" : change.status}
        </span>
      )}
    </li>
  );
}

/** One side of a field's before and after, in words (`settingValue`). */
function show(value: unknown, side: "from" | "to"): string {
  return settingValue((value as Record<string, unknown> | null)?.[side]);
}
