import type { Ticket } from "@andy/contracts";

/**
 * The board's epic view controls (AI-86): "Group by epic" (remembered per viewer) and a filter
 * that shows one epic's tickets, hidden while the board has no epic. Both change the view only.
 */
export function EpicControls({
  epics,
  grouped,
  onGroupedChange,
  epicId,
  onEpicChange,
}: {
  epics: readonly Ticket[];
  grouped: boolean;
  onGroupedChange: (on: boolean) => void;
  epicId: string | null;
  onEpicChange: (epicId: string | null) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={grouped}
          onChange={(e) => onGroupedChange(e.target.checked)}
        />
        Group by epic
      </label>
      {epics.length > 0 && (
        <label className="flex items-center gap-1 text-sm">
          Epic
          <select
            className="max-w-48 rounded border border-border bg-background px-1"
            value={epicId ?? ""}
            onChange={(e) => onEpicChange(e.target.value || null)}
          >
            <option value="">All tickets</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.key}: {e.title}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
