import { Link } from "@tanstack/react-router";
import type { Ticket } from "@andy/contracts";
import { Button } from "@/components/ui/button";
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
 * With an epic picked, Open goes to its panel (AI-403): an epic has no card, and one with no
 * tickets has no header either.
 */
export function EpicControls({
  projectId,
  epics,
  grouped,
  onGroupedChange,
  epicId,
  onEpicChange,
}: {
  projectId: string;
  epics: readonly Ticket[];
  grouped: boolean;
  onGroupedChange: (on: boolean) => void;
  epicId: string | null;
  onEpicChange: (epicId: string | null) => void;
}) {
  const picked = epics.find((e) => e.id === epicId);
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
      {picked && (
        <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
          <Link
            to="/p/$projectId/t/$ticketRef"
            params={{ projectId, ticketRef: picked.key }}
            aria-label={`Open epic ${picked.key}: ${picked.title}`}
          >
            Open
          </Link>
        </Button>
      )}
    </>
  );
}
