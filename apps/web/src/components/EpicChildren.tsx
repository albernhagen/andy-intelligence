import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { NightLaunch } from "@/components/NightLaunch";
import { Loading, QueryError } from "@/components/Status";
import { StageBadge, TypeMarker } from "@/components/TicketMarkers";
import { Badge } from "@/components/ui/badge";
import { unwrap, useApi } from "@/lib/api";
import type { components } from "@/lib/api.gen";
import { showsError, useLivePoll } from "@/lib/live";

type EpicRollup = components["schemas"]["EpicRollup"];
type TicketPath = { projectId: string; ticketId: string };

/**
 * An epic's children and roll-up (AI-85), computed by the API on read. Polled slowly: one
 * roll-up reads every child's agent tasks (capped), so it isn't worth a 5 s poll.
 */
export function useEpicRollup(path: TicketPath) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["epic", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/epic", { params: { path } }),
      ),
  });
}

/** "3 of 5 done · Cost ~$1.50 (estimate)", with "partial" when the cost missed some stories. */
export function formatEpicRollup(r: Pick<EpicRollup, "progress" | "cost" | "partial">): string {
  const { cost } = r;
  const allUnknown = cost.completedRuns > 0 && cost.unknownRuns === cost.completedRuns;
  return [
    `${r.progress.done} of ${r.progress.total} done`,
    cost.completedRuns === 0
      ? null
      : allUnknown
        ? "Cost unknown"
        : `Cost ~$${cost.estimatedCostUsd.toFixed(2)} (estimate${r.partial ? ", partial" : ""})`,
    cost.unknownRuns > 0 &&
      !allUnknown &&
      `${cost.unknownRuns} ${cost.unknownRuns === 1 ? "agent task" : "agent tasks"} unknown`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The epic's stories in dependency order, with progress and summed cost. */
export function EpicChildren(path: TicketPath) {
  const rollup = useEpicRollup(path);
  const r = rollup.data;
  return (
    <>
      <StoryList path={path} />
      {r && r.children.length > 0 && <NightLaunch {...path} />}
    </>
  );
}

function StoryList({ path }: { path: TicketPath }) {
  const rollup = useEpicRollup(path);
  const r = rollup.data;
  return (
    <section aria-label="Stories" className="space-y-2">
      <h3 className="text-sm font-medium">Stories</h3>
      {rollup.isPending && <Loading />}
      {showsError(rollup) && <QueryError error={rollup.error} />}
      {r && r.children.length === 0 && (
        <p className="text-sm text-muted-foreground">No stories under this epic yet.</p>
      )}
      {r && r.children.length > 0 && (
        <>
          <p aria-label="Epic progress" className="text-sm text-muted-foreground tabular-nums">
            {formatEpicRollup(r)}
          </p>
          {r.partial && (
            <p className="text-xs text-muted-foreground">
              Cost counts {r.costedChildren} of {r.progress.total} stories, those likeliest to have
              agent tasks.
            </p>
          )}
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {r.children.map((c) => (
              <li key={c.id} className="flex min-h-8 flex-wrap items-center gap-2 px-2 py-1">
                <Link
                  to="/p/$projectId/t/$ticketRef"
                  params={{ projectId: path.projectId, ticketRef: c.key }}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  <span className="text-muted-foreground tabular-nums">{c.key}:</span> {c.title}
                </Link>
                <TypeMarker type={c.type} />
                {c.size && <Badge>{c.size}</Badge>}
                <StageBadge stage={c.stage} archived={false} />
                {c.openBlockers.length > 0 && (
                  <Badge variant="danger">Blocked by {c.openBlockers.join(", ")}</Badge>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
