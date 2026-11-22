import { useQuery } from "@tanstack/react-query";
import { unwrap, useApi } from "@/lib/api";
import { useLivePoll } from "@/lib/live";
import { hasActiveRun } from "@/lib/queries";

/**
 * The in-flight view (ADR-0080): the project's runs in flight, oldest first, with what each may
 * touch. The dispatcher skips Ready tickets overlapping a build here. Polls while any runs. The
 * ticket's status line reads it; the board's In flight box was removed (AI-342), and a running
 * build's branch and touches show on its ticket's agent task row. MCP `list_in_flight` stays.
 */
export function useInFlight(projectId: string) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("live", hasActiveRun),
    queryKey: ["in-flight", projectId],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/in-flight", { params: { path: { projectId } } }),
      ),
  });
}
