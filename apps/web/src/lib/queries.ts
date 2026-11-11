import { useEffect, useRef } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AutoMerge,
  PlanApproval,
  Run,
  Size,
  Stage,
  TicketOverrides,
  TicketType,
  Worker,
  WorkerChoice,
} from "@andy/contracts";
import { unwrap, useApi } from "./api";
import { useLivePoll } from "./live";
import { withoutQuestion, type NeedsYou } from "./needs-you";

/**
 * Query hooks over the generated API client. One user, small data: every write refetches all.
 * Views stay current by tuned polling (`useLivePoll`, AI-9); the digest and GitHub refetch on focus.
 */

/** Subscription quota for the header gauge and banner; polled slowly (60 s). */
export function useQuota() {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["quota"],
    queryFn: async () => unwrap(await api.GET("/api/quota")),
  });
}

/** A project's digest for the last `hours` (AI-70); computed on read, refetched on focus. */
export function useDigest(projectId: string, hours: number) {
  const api = useApi();
  return useQuery({
    queryKey: ["digest", projectId, hours],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/digest", {
          params: { path: { projectId }, query: { hours } },
        }),
      ),
  });
}

export function useProjects() {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["projects"],
    queryFn: async () => unwrap(await api.GET("/api/projects")),
  });
}

/**
 * The board's tickets with their card status (AI-28: Board v2). Polled; a card with a run in
 * flight keeps it at 5 s even while Andy is idle, so the elapsed time and the run's end show up.
 */
export function useBoard(projectId: string) {
  const api = useApi();
  return useQuery({
    ...useLivePoll<{ summary: { run: Pick<Run, "status"> | null } }[]>("live", (tickets) =>
      tickets.some((t) => t.summary.run && isActiveRun(t.summary.run)),
    ),
    queryKey: ["board", projectId],
    queryFn: async () =>
      unwrap(await api.GET("/api/projects/{projectId}/board", { params: { path: { projectId } } })),
  });
}

export function useTickets(projectId: string) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
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
    ...useLivePoll("live"),
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
    ...useLivePoll("live"),
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
    ...useLivePoll("live"),
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
    ...useLivePoll("live"),
    queryKey: ["questions", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/questions", {
          params: { path },
        }),
      ),
  });
}

export function useWorker(path: TicketPath) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    queryKey: ["worker", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/worker", { params: { path } }),
      ),
  });
}

export function useSetWorker(path: TicketPath) {
  const api = useApi();
  return useWrite(async (body: { worker: WorkerChoice | null }) =>
    unwrap(
      await api.PUT("/api/projects/{projectId}/tickets/{ticketId}/worker", {
        params: { path },
        body,
      }),
    ),
  );
}

export const isActiveRun = (run: Pick<Run, "status">) =>
  run.status === "queued" || run.status === "running";

/** For `useLivePoll`: a list with a run queued or running keeps polling at 5 s. */
export const hasActiveRun = (runs: readonly Pick<Run, "status">[]) => runs.some(isActiveRun);

/**
 * The ticket's agent runs, newest first. When a run it saw in flight finishes, everything is
 * refetched, so the agent's comment, questions and ticket changes show up.
 */
export function useRuns(path: TicketPath) {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...useLivePoll("live", hasActiveRun),
    queryKey: ["runs", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/runs", { params: { path } }),
      ),
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
    ...useLivePoll("live"),
    queryKey: ["needs-you"],
    queryFn: async () => unwrap(await api.GET("/api/needs-you")),
  });
}

/**
 * A mutation that refetches everything on success, so the board, detail and inbox agree.
 * `applied` patches the cache first, so a screen can change before the refetch lands.
 */
function useWrite<V, R>(
  fn: (vars: V) => Promise<R>,
  applied?: (queryClient: QueryClient, vars: V) => void,
  mutationKey?: readonly unknown[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey,
    mutationFn: fn,
    onSuccess: (_data, vars) => {
      applied?.(queryClient, vars);
      return queryClient.invalidateQueries();
    },
  });
}

/** Andy's clear of a quota idle (AI-74): discards the reading holding dispatch at the reserve. */
export function useClearQuotaIdle() {
  const api = useApi();
  return useWrite(async () => unwrap(await api.POST("/api/quota/clear")));
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
      dailyQuestionCap?: number;
      autoBuild?: boolean;
      buildEnabled?: boolean;
      planApproval?: PlanApproval;
      autoMerge?: AutoMerge;
      runsAtOnce?: number;
      paused?: boolean;
      defaultWorker?: Worker;
      emailNotifications?: boolean;
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

/** One in-place edit: only the changed fields, plus the `updatedAt` it was read at (409 if stale). */
export type TicketPatch = Partial<
  TicketInput & { parentId: string | null; blockedBy: string[] }
> & {
  ifUpdatedAt: string;
};

export function useUpdateTicket(path: TicketPath) {
  const api = useApi();
  return useWrite(async (body: TicketPatch) =>
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

/** Sets a ticket's place in its lane (ADR-0058: order is priority); `rank` from `planDrop`. */
export function useRankTicket(projectId: string) {
  const api = useApi();
  return useWrite(async ({ ticketId, rank }: { ticketId: string; rank: string }) =>
    unwrap(
      await api.PATCH("/api/projects/{projectId}/tickets/{ticketId}", {
        params: { path: { projectId, ticketId } },
        body: { rank },
      }),
    ),
  );
}

/** Moves a ticket between Ideas and Up next, or reorders Up next (ADR-0075). */
export function useSetUpNext(projectId: string) {
  const api = useApi();
  return useWrite(
    async ({
      ticketId,
      upNext,
      rank,
    }: {
      ticketId: string;
      upNext: boolean;
      rank?: string | null;
    }) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/tickets/{ticketId}/up-next", {
          params: { path: { projectId, ticketId } },
          body: { upNext, rank: rank ?? null },
        }),
      ),
  );
}

/** Turns one of refine's assumptions into an open question (ADR-0075). */
export function usePromoteAssumption(path: TicketPath) {
  const api = useApi();
  return useWrite(async (assumptionId: string) =>
    unwrap(
      await api.POST(
        "/api/projects/{projectId}/tickets/{ticketId}/assumptions/{assumptionId}/promote",
        { params: { path: { ...path, assumptionId } } },
      ),
    ),
  );
}

/** Quick add: a title alone; refine drafts the rest (ADR-0058). */
export function useQuickAdd(projectId: string) {
  const api = useApi();
  return useWrite(async (title: string) =>
    unwrap(
      await api.POST("/api/projects/{projectId}/tickets", {
        params: { path: { projectId } },
        body: { title },
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

/** Key of answers in flight on one ticket, so its inbox card can lock while any runs. */
export const answerKey = (ticketId: string) => ["answer", ticketId] as const;

/** An answered question leaves the inbox (and the header count) as soon as the API confirms it. */
export function useAnswerQuestion(ticketId?: string) {
  const api = useApi();
  return useWrite(
    async ({ questionId, answer }: { questionId: string; answer: string }) =>
      unwrap(
        await api.POST("/api/questions/{questionId}/answer", {
          params: { path: { questionId } },
          body: { answer },
        }),
      ),
    (queryClient, { questionId }) =>
      queryClient.setQueryData<NeedsYou>(
        ["needs-you"],
        (data) => data && withoutQuestion(data, questionId),
      ),
    ticketId ? answerKey(ticketId) : undefined,
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
