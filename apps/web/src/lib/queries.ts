import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlanApproval, Run, Size, Stage, TicketOverrides, TicketType } from "@andy/contracts";
import { unwrap, useApi } from "./api";

/** Query hooks over the generated API client. One user, small data: every write refetches all. */

export function useProjects() {
  const api = useApi();
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => unwrap(await api.GET("/api/projects")),
  });
}

export function useTickets(projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["tickets", projectId],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets", { params: { path: { projectId } } }),
      ),
  });
}

type TicketPath = { projectId: string; ticketId: string };

export const ticketQueryKey = (projectId: string, ref: string) => ["ticket", projectId, ref];

/** A ticket by key (`AI-2`, readable links) or by id (older links). */
export function useTicketByRef(projectId: string, ref: string) {
  const api = useApi();
  return useQuery({
    queryKey: ticketQueryKey(projectId, ref),
    queryFn: async () =>
      isTicketKey(ref)
        ? unwrap(await api.GET("/api/tickets/{key}", { params: { path: { key: ref } } }))
        : unwrap(
            await api.GET("/api/projects/{projectId}/tickets/{ticketId}", {
              params: { path: { projectId, ticketId: ref } },
            }),
          ),
  });
}

export const isTicketKey = (ref: string) => /^[A-Z][A-Z0-9]{0,9}-\d+$/.test(ref);

export function useReadiness(path: TicketPath) {
  const api = useApi();
  return useQuery({
    queryKey: ["readiness", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/readiness", {
          params: { path },
        }),
      ),
  });
}

export function useEvents(path: TicketPath) {
  const api = useApi();
  return useQuery({
    queryKey: ["events", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/events", { params: { path } }),
      ),
  });
}

export function useTicketQuestions(path: TicketPath) {
  const api = useApi();
  return useQuery({
    queryKey: ["questions", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/questions", {
          params: { path },
        }),
      ),
  });
}

/** How often the runs list refetches while a run is queued or running. */
export const RUN_POLL_MS = 5_000;

export const isActiveRun = (run: Pick<Run, "status">) =>
  run.status === "queued" || run.status === "running";

/** Poll only while a run is in flight; stop once every run has finished (no websockets). */
export function runsRefetchInterval(runs: readonly Pick<Run, "status">[] | undefined) {
  return runs?.some(isActiveRun) ? RUN_POLL_MS : false;
}

/**
 * The ticket's agent runs, newest first. When a run it saw in flight finishes, everything is
 * refetched, so the agent's comment, questions and ticket changes show up.
 */
export function useRuns(path: TicketPath) {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["runs", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/runs", { params: { path } }),
      ),
    refetchInterval: (q) => runsRefetchInterval(q.state.data),
  });

  const active = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!query.data) return;
    const finished = query.data.some((r) => active.current.has(r.id) && !isActiveRun(r));
    active.current = new Set(query.data.filter(isActiveRun).map((r) => r.id));
    if (finished) void queryClient.invalidateQueries();
  }, [query.data, queryClient]);

  return query;
}

export function useNeedsYou() {
  const api = useApi();
  return useQuery({
    queryKey: ["needs-you"],
    queryFn: async () => unwrap(await api.GET("/api/needs-you")),
  });
}

/** A mutation that refetches everything on success, so the board, detail and inbox agree. */
function useWrite<V, R>(fn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useCreateProject() {
  const api = useApi();
  return useWrite(async (body: { name: string; key: string; repos: string[] }) =>
    unwrap(await api.POST("/api/projects", { body })),
  );
}

/** Project settings (ADR-0054: autoRefine; ADR-0063: autoBuild; ADR-0050: planApproval). */
export function useUpdateProject(projectId: string) {
  const api = useApi();
  return useWrite(
    async (body: {
      autoRefine?: boolean;
      autoBuild?: boolean;
      buildEnabled?: boolean;
      planApproval?: PlanApproval;
    }) =>
      unwrap(
        await api.PATCH("/api/projects/{projectId}", { params: { path: { projectId } }, body }),
      ),
  );
}

export type TicketInput = {
  type: TicketType | null;
  title: string;
  body: string;
  acceptanceCriteria: string[];
  assumptions: string[];
  size: Size | null;
  sizeReason: string | null;
  outOfScope: string[];
  touches: string[];
  overrides: TicketOverrides;
};

export function useCreateTicket(projectId: string) {
  const api = useApi();
  return useWrite(async (body: TicketInput) =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets", {
        params: { path: { projectId } },
        body,
      }),
    ),
  );
}

export function useUpdateTicket(path: TicketPath) {
  const api = useApi();
  return useWrite(async (body: TicketInput & { ifUpdatedAt: string }) =>
    unwrap(
      await api.PATCH("/api/projects/{projectId}/tickets/{ticketId}", { params: { path }, body }),
    ),
  );
}

export function useMoveTicket(path: TicketPath) {
  const api = useApi();
  return useWrite(async (body: { to: Stage; force: boolean; reason: string | null }) =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets/{ticketId}/stage", {
        params: { path },
        body,
      }),
    ),
  );
}

export function useCancelTicket(path: TicketPath) {
  const api = useApi();
  return useWrite(async (body: { reason: string | null }) =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets/{ticketId}/cancel", {
        params: { path },
        body,
      }),
    ),
  );
}

export function useArchiveTicket(path: TicketPath) {
  const api = useApi();
  return useWrite(async (body: { archived: boolean }) =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets/{ticketId}/archive", {
        params: { path },
        body,
      }),
    ),
  );
}

/** Board drag-and-drop: one mutation for every card, so the ticket id comes with each call. */
export function useBoardMove(projectId: string) {
  const api = useApi();
  return useWrite(async ({ ticketId, ...body }: { ticketId: string; to: Stage; force: boolean }) =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets/{ticketId}/stage", {
        params: { path: { projectId, ticketId } },
        body: { ...body, reason: null },
      }),
    ),
  );
}

export function useAddComment(path: TicketPath) {
  const api = useApi();
  return useWrite(async (body: { body: string }) =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets/{ticketId}/comments", {
        params: { path },
        body,
      }),
    ),
  );
}

export function useAskQuestion(path: TicketPath) {
  const api = useApi();
  return useWrite(
    async (body: { text: string; options: string[]; suggestedAnswer: string | null }) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/tickets/{ticketId}/questions", {
          params: { path },
          body,
        }),
      ),
  );
}

export function useAnswerQuestion() {
  const api = useApi();
  return useWrite(async ({ questionId, answer }: { questionId: string; answer: string }) =>
    unwrap(
      await api.POST("/api/questions/{questionId}/answer", {
        params: { path: { questionId } },
        body: { answer },
      }),
    ),
  );
}

export function useStartRun(path: TicketPath) {
  const api = useApi();
  return useWrite(async (body: { step: "refine" | "plan" | "build" }) =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets/{ticketId}/runs", {
        params: { path },
        body,
      }),
    ),
  );
}

/** Andy's decision on a plan run (ADR-0050); approving starts the build when it can. */
export function useDecidePlan(path: TicketPath) {
  const api = useApi();
  return useWrite(
    async ({
      runId,
      ...body
    }: {
      runId: string;
      decision: "approved" | "rejected";
      reason?: string;
    }) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/tickets/{ticketId}/runs/{runId}/plan-decision", {
          params: { path: { ...path, runId } },
          body,
        }),
      ),
  );
}

/** GitHub App connection and installed repos (ADR-0043). Errors when GitHub isn't configured. */
export function useGitHub() {
  const api = useApi();
  return useQuery({
    queryKey: ["github"],
    queryFn: async () => unwrap(await api.GET("/api/github")),
    retry: false,
  });
}

export function useConnectGitHub() {
  const api = useApi();
  return useWrite(async (code: string) =>
    unwrap(await api.POST("/api/github/connect", { body: { code } })),
  );
}
