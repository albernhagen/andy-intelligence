import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Stage } from "@andy/contracts";
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

export function useTicket(path: TicketPath) {
  const api = useApi();
  return useQuery({
    queryKey: ["ticket", path],
    queryFn: async () =>
      unwrap(await api.GET("/api/projects/{projectId}/tickets/{ticketId}", { params: { path } })),
  });
}

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

export type TicketInput = {
  title: string;
  body: string;
  acceptanceCriteria: string[];
  assumptions: string[];
  size: "S" | "M" | "L" | null;
  sizeReason: string | null;
  tier: "frontier" | "strong" | "fast" | "cheap" | null;
};

export function useCreateTicket(projectId: string) {
  const api = useApi();
  return useWrite(async (body: TicketInput & { type: "epic" | "story" | "task" | "bug" }) =>
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
