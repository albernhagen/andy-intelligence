import type { Stage, TicketType } from "@andy/contracts";
import { Bug, CircleDashed, Flag, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STAGE_LABELS, typeLabel } from "@/lib/tickets";

/** Status markers shared by the inbox, board and ticket page (design.md: "Status markers"). */

const TYPE_ICONS: Record<TicketType, LucideIcon> = {
  feature: Sparkles,
  bug: Bug,
  chore: Wrench,
  epic: Flag,
};

/** Type: a muted icon with the type name as its label. */
export function TypeMarker({ type }: { type: TicketType | null }) {
  const Icon = type ? TYPE_ICONS[type] : CircleDashed;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
      {typeLabel(type)}
    </span>
  );
}

/** Where the ticket is: its stage, and "Archived" when it is. Done reads as success. */
export function StageBadge({ stage, archived }: { stage: Stage; archived: boolean }) {
  return (
    <>
      <Badge variant={stage === "done" ? "success" : "default"}>{STAGE_LABELS[stage]}</Badge>
      {archived && <Badge>Archived</Badge>}
    </>
  );
}
