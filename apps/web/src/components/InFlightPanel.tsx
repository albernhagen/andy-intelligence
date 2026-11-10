import { useQuery } from "@tanstack/react-query";
import { adrLabel } from "@andy/domain";
import { QueryError } from "@/components/Status";
import { unwrap, useApi } from "@/lib/api";
import { runsRefetchInterval } from "@/lib/queries";

/**
 * The in-flight view (ADR-0080): the project's runs in flight, oldest first, with what each may
 * touch. The dispatcher skips Ready tickets overlapping a build here. Polls while any runs.
 */
export function useInFlight(projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["in-flight", projectId],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/in-flight", { params: { path: { projectId } } }),
      ),
    refetchInterval: (q) => runsRefetchInterval(q.state.data),
  });
}

/** Only links that are plainly web addresses; the PR URL came from a run's report. */
const safeUrl = (url: string | null) => (url?.startsWith("https://") ? url : null);

export function InFlightPanel({ projectId }: { projectId: string }) {
  const inFlight = useInFlight(projectId);
  if (inFlight.isError) return <QueryError error={inFlight.error} />;
  const runs = inFlight.data ?? [];
  if (runs.length === 0) return null;
  return (
    <section aria-label="In flight" className="rounded-md border p-3 text-sm">
      <h3 className="mb-2 font-medium">In flight</h3>
      <ul className="space-y-2">
        {runs.map((r) => {
          const pr = safeUrl(r.pullRequest);
          return (
            <li key={r.runId} className="min-w-0 space-y-0.5">
              <p className="truncate">
                <span className="font-medium">{r.ticketKey ?? "No ticket"}</span>{" "}
                {r.ticketTitle && <span>{r.ticketTitle}</span>}
                <span className="text-muted-foreground">
                  {" "}
                  · {r.step} {r.status}
                  {r.startedAt && ` since ${new Date(r.startedAt).toLocaleTimeString()}`}
                  {r.reservedAdr !== null && ` · ${adrLabel(r.reservedAdr)}`}
                </span>
              </p>
              <p className="truncate text-muted-foreground">
                {r.branch && <code>{r.branch}</code>}
                {pr && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={pr} target="_blank" rel="noreferrer" className="underline">
                      PR
                    </a>
                  </>
                )}
              </p>
              {r.step === "build" && (
                // Only builds edit files, so only they block overlapping tickets (ADR-0080).
                <p className="break-words text-muted-foreground">
                  Touches:{" "}
                  {r.touches.length ? r.touches.join(", ") : "unknown (blocks every ticket)"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
