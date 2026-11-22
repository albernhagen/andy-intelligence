import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loading, QueryError } from "@/components/Status";
import { useSetupChecklist } from "@/lib/queries";
import { showsError } from "@/lib/live";

type Status = "done" | "missing" | "unknown" | "not_yet";

/** Colour never carries meaning alone (design.md): each badge says its state in words. */
const MARKERS: Record<
  Status,
  { text: string; variant: "success" | "attention" | "danger" | "default" }
> = {
  done: { text: "Done", variant: "success" },
  missing: { text: "Missing", variant: "attention" },
  unknown: { text: "Unknown", variant: "danger" },
  not_yet: { text: "Not yet", variant: "default" },
};

/**
 * The project's setup checklist (AI-95: M5.15, from AI-65): repo connected, baseline merged,
 * deploy proven, threat model started, budget caps set. Shown until every step is done, then
 * hidden. Read-only: it never does a step. Open the first time it's seen in this browser, then
 * folded to its one-line summary (AI-339); a click opens it again.
 */
export function SetupChecklist({ projectId }: { projectId: string }) {
  const setup = useSetupChecklist(projectId);
  const [open, setOpen] = useState(() => !seen(projectId));
  useEffect(() => markSeen(projectId), [projectId]);
  if (setup.isPending) return <Loading />;
  if (setup.data === undefined || showsError(setup)) return <QueryError error={setup.error} />;
  if (setup.data.complete) return null;
  const left = setup.data.items.filter((i) => i.status !== "done").length;
  const waiting = setup.data.items.filter((i) => i.status === "not_yet").map((i) => i.label);

  return (
    <details
      aria-labelledby="setup-heading"
      className="space-y-1"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary id="setup-heading" className="cursor-pointer text-sm font-medium">
        Setup: {left} of {setup.data.items.length} left
        {setup.data.repo && (
          <span className="font-normal text-muted-foreground"> · checked {setup.data.repo}</span>
        )}
      </summary>
      <ul
        aria-label="Setup checklist"
        className="divide-y divide-border rounded-md border border-border"
      >
        {setup.data.items.map((item) => {
          const marker = MARKERS[item.status];
          return (
            <li key={item.key} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-sm">
              <Badge variant={marker.variant}>{marker.text}</Badge>
              <span>{item.label}</span>
              {item.detail && <span className="text-xs text-muted-foreground">{item.detail}</span>}
            </li>
          );
        })}
      </ul>
      {waiting.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {waiting.join(" and ")}: nothing to do here yet; they wait on M6: Dev → prod releases, so
          this checklist stays visible until then.
        </p>
      )}
    </details>
  );
}

// Storage can be blocked (private mode, policy): then the checklist simply opens each time.
const seenKey = (projectId: string) => `setup-seen:${projectId}`;
function seen(projectId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(projectId)) === "1";
  } catch {
    return false;
  }
}
function markSeen(projectId: string) {
  try {
    window.localStorage.setItem(seenKey(projectId), "1");
  } catch {
    // Not remembering is fine.
  }
}
