import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReleaseListItem } from "@andy/contracts";
import { isOwner, OWNER_LABEL } from "@andy/domain";
import { Badge } from "@/components/ui/badge";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ReleaseNotes } from "./ReleaseNotes";

/**
 * One deployment on the Releases page (AI-189: M6.10): status, revision, time and actor at a
 * glance; expanding it shows its links, the tickets it shipped and its release notes.
 */
export function DeploymentRow({
  item,
  projectId,
  repo,
}: {
  item: ReleaseListItem;
  projectId: string;
  /** The project's first repo ("owner/name"), for the commit link; null when it has none. */
  repo: string | null;
}) {
  const [open, setOpen] = useState(false);
  const d = item.deployment;
  const status = STATUS[d.status];
  const run = d.actor.startsWith("agent:") ? d.actor.slice("agent:".length) : null;
  const panelId = `deployment-${d.id}`;
  return (
    <li className="rounded-lg border border-border bg-raised">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-start gap-2 rounded-lg p-2 text-left focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {d.kind !== "deploy" && <Badge>{KIND[d.kind]}</Badge>}
            <span className="min-w-0 truncate font-mono text-xs">
              {d.revision ?? d.gitSha.slice(0, 7)}
            </span>
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {dateTime(d.finishedAt ?? d.startedAt)} · {actorText(d.actor)}
            {item.tickets.length > 0 &&
              ` · ${item.tickets.length} ticket${item.tickets.length === 1 ? "" : "s"}`}
          </span>
        </span>
      </button>
      {open && (
        <div id={panelId} className="space-y-3 border-t border-border p-2 pl-8">
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {repo ? (
              <a
                href={`https://github.com/${repo}/commit/${d.gitSha}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline-offset-2 hover:underline"
              >
                Commit {d.gitSha.slice(0, 7)}
              </a>
            ) : (
              <span className="font-mono">Commit {d.gitSha.slice(0, 7)}</span>
            )}
            {d.url && (
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                Open {d.environment}
              </a>
            )}
            {run && (
              <Link
                to="/p/$projectId/runs/$runId"
                params={{ projectId, runId: run }}
                className="underline-offset-2 hover:underline"
              >
                Agent task
              </Link>
            )}
            <span>Started {dateTime(d.startedAt)}</span>
          </p>
          {item.tickets.length > 0 && (
            <ul aria-label="Tickets shipped" className="flex flex-wrap gap-x-3 gap-y-1">
              {item.tickets.map((t) => (
                <li key={t.key}>
                  <Link
                    to="/p/$projectId/t/$ticketRef"
                    params={{ projectId, ticketRef: t.key }}
                    className="underline-offset-2 hover:underline"
                  >
                    {t.title ? `${t.key}: ${t.title}` : t.key}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ReleaseNotes release={item.release} />
        </div>
      )}
    </li>
  );
}

const STATUS = {
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  started: { label: "Deploying", variant: "running" },
} as const;

const KIND = { promote: "Promote", rollback: "Rollback" } as const;

/** The owner (a signed-in user), `agent:<runId>` or `system`, in words. */
export function actorText(actor: string): string {
  if (isOwner(actor)) return OWNER_LABEL;
  if (actor.startsWith("agent:")) return "an agent task";
  if (actor === "system") return "the deploy workflow";
  return actor;
}
