import type { Ticket } from "@andy/contracts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/** Radix Select can't hold an empty value; this one stands for "every ticket". */
const ALL = "all";

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
      <Switch label="Group by epic" checked={grouped} onCheckedChange={onGroupedChange} />
      {epics.length > 0 && (
        <Select
          value={epicId ?? ALL}
          onValueChange={(value) => onEpicChange(value === ALL ? null : value)}
        >
          <SelectTrigger aria-label="Epic" className="w-auto max-w-56 sm:h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All tickets</SelectItem>
            {epics.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.key}: {e.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );
}
