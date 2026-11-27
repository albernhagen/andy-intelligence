import { useQuery } from "@tanstack/react-query";
import { unwrap, useApi } from "@/lib/api";
import type { components } from "@/lib/api.gen";
import { useLivePoll } from "@/lib/live";

type Schema = components["schemas"]["ProjectRoadmap"];
/** A top-level epic, with its child epics nested one level (AI-403 lists them). */
export type ChildEpic = Omit<Schema["epics"][number]["children"][number], "children">;
export type Epic = Omit<Schema["epics"][number], "children"> & { children: ChildEpic[] };
export type ProjectRoadmap = Omit<Schema, "epics"> & { epics: Epic[] };
export type Milestone = Schema["milestones"][number];
export type Counts = Milestone["counts"];

/**
 * `GET /api/projects/{id}/roadmap`, or `GET /api/roadmap` under All projects (AI-193, AI-305):
 * polled at the slow pace, as the roadmap moves only when tickets do (ADR-0091). The roadmap and
 * the milestone page (AI-405) share it, so both read one cache entry per project.
 */
export function useRoadmap(projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["roadmap", projectId ?? null],
    queryFn: async () =>
      projectId
        ? {
            projects: [
              unwrap(
                await api.GET("/api/projects/{projectId}/roadmap", {
                  params: { path: { projectId } },
                }),
              ),
            ],
            truncated: false,
          }
        : unwrap(await api.GET("/api/roadmap")),
  });
}
