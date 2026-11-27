import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BriefAnswers, MarkStepBody, ProjectPlan } from "@andy/contracts";
import { plainAnswer } from "@andy/domain";
import { unwrap, useApi } from "@/lib/api";
import { useLivePoll } from "@/lib/live";
import { toast } from "@/components/ui/toast";
import { errorText } from "@/lib/api";
import { useProjects } from "@/lib/queries";
import type { SetupFacts } from "@/lib/setup-steps";

/** The setup path's reads and writes (AI-373), over routes the API already had plus GET brief. */

export function useBriefStatus(projectId: string, enabled = true) {
  const api = useApi();
  const poll = useLivePoll("slow");
  return useQuery({
    ...poll,
    // Merged is final for this path: stop polling, so an open tab costs no more code-host reads.
    refetchInterval: (q: { state: { data: unknown } }) => {
      const d = q.state.data as { readable?: boolean; onDefaultBranch?: boolean } | undefined;
      return d?.readable && d.onDefaultBranch ? false : poll.refetchInterval(q);
    },
    enabled,
    queryKey: ["brief", projectId],
    queryFn: async () =>
      unwrap(await api.GET("/api/projects/{projectId}/brief", { params: { path: { projectId } } })),
  });
}

/**
 * The onboarding steps (AI-381), polled so a step done in GitHub ticks itself off; the API caches
 * its code-host reads (ADR-0028). Polling stops once every step is done.
 */
export function useOnboarding(projectId: string, enabled: boolean) {
  const api = useApi();
  const poll = useLivePoll("slow");
  return useQuery({
    ...poll,
    refetchInterval: (q: { state: { data: unknown } }) =>
      (q.state.data as { complete?: boolean } | undefined)?.complete
        ? false
        : poll.refetchInterval(q),
    enabled,
    queryKey: ["onboarding", projectId],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/onboarding", {
          params: { path: { projectId }, query: {} },
        }),
      ),
  });
}

/** "Check again": reads the code host afresh (the API allows it every 10 s at most). */
export function useCheckAgain(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/onboarding", {
          params: { path: { projectId }, query: { refresh: "true" } },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(["onboarding", projectId], data),
  });
}

/** Marks a GitHub or terminal step done by hand, or clears the mark (owner only). */
export function useMarkStep(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: MarkStepBody) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/onboarding/marks", {
          params: { path: { projectId } },
          body,
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(["onboarding", projectId], data),
  });
}

/** Starts the proving refine on an Up-next ticket: the ticket page's own route. */
export function useStartRefine(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ticketId: string) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/tickets/{ticketId}/runs", {
          params: { path: { projectId, ticketId } },
          body: { step: "refine" },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["onboarding", projectId] }),
  });
}

/** The project's plan, polled so a plan a plan-project task proposes shows without a reload. */
export function useProjectPlan(projectId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("slow"),
    enabled,
    queryKey: ["project-plan", projectId],
    queryFn: async () =>
      unwrap(await api.GET("/api/projects/{projectId}/plan", { params: { path: { projectId } } })),
  });
}

/** Submits the brief through the same route and service as MCP `submit_brief`. */
export function useSubmitBrief(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (answers: BriefAnswers) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/brief", {
          params: { path: { projectId } },
          body: answers,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brief", projectId] }),
  });
}

/** Starts a plan-project agent task (AI-134's route, as MCP `start_plan_project`). */
export function useStartPlanTask(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/projects/{projectId}/plan/agent-task", {
          params: { path: { projectId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** The milestone name plan approval gives planned milestone `i` (`project-plan.ts`). */
export function plannedMilestoneName(plan: ProjectPlan, i: number): string {
  return `M${i + 1}: ${plainAnswer(plan.proposal.milestones[i]!.title)}`;
}

/**
 * Approves the plan, then parks the milestones Andy chose to park. Approval creates every
 * milestone approved with its case (ADR-0149); each park is the owner's logged status change, as
 * on the roadmap. A park that fails leaves that milestone approved and reports which.
 */
export function useApprovePlan(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ plan, parked }: { plan: ProjectPlan; parked: number[] }) => {
      const decided = unwrap(
        await api.POST("/api/projects/{projectId}/plan/decision", {
          params: { path: { projectId } },
          body: { decision: "approved" },
        }),
      );
      if (parked.length === 0) return { plan: decided.plan, parked: [] as string[] };
      const milestones = unwrap(
        await api.GET("/api/projects/{projectId}/milestones", { params: { path: { projectId } } }),
      );
      const names: string[] = [];
      for (const i of parked) {
        const name = plannedMilestoneName(plan, i);
        const found = milestones.find((m) => m.name === name);
        if (!found) throw new Error(`Approved, but couldn't find ${name} to park it`);
        try {
          unwrap(
            await api.PATCH("/api/projects/{projectId}/milestones/{milestoneId}", {
              params: { path: { projectId, milestoneId: found.id } },
              body: { status: "parked" },
            }),
          );
        } catch (err) {
          throw new Error(`Approved, but couldn't park ${name}: ${errorText(err)}`, { cause: err });
        }
        names.push(name);
      }
      return { plan: decided.plan, parked: names };
    },
    // On the hook, not the caller: an approved plan moves the page to the next step, which
    // unmounts the approve step and would drop its error, so a park that failed is said here.
    onError: (err) =>
      toast({
        title: "A milestone wasn't parked",
        description: `${errorText(err)}. It is approved; park it on the roadmap.`,
        tone: "destructive",
      }),
    onSettled: () => queryClient.invalidateQueries(),
  });
}

/** Sends the plan back with Andy's note: the API's rejection with a reason. */
export function useSendBackPlan(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reason: string) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/plan/decision", {
          params: { path: { projectId } },
          body: { decision: "rejected", reason },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/**
 * Everything the setup steps read. `facts` is undefined until every read answered; `error` is the
 * first failed read, so the caller shows it instead of guessing a step.
 */
export function useSetupFacts(projectId: string, enabled = true) {
  const projects = useProjects();
  const brief = useBriefStatus(projectId, enabled);
  const plan = useProjectPlan(projectId, enabled);
  const onboarding = useOnboarding(projectId, enabled);
  const project = projects.data?.find((p) => p.id === projectId);
  const error = projects.error ?? brief.error ?? plan.error ?? onboarding.error ?? null;
  const ready =
    project !== undefined &&
    brief.data !== undefined &&
    plan.data !== undefined &&
    onboarding.data !== undefined;
  const facts: SetupFacts | undefined = ready
    ? {
        briefOnDefaultBranch: brief.data.readable ? brief.data.onDefaultBranch : null,
        plan: plan.data.plan,
        onboarding: onboarding.data,
      }
    : undefined;
  const retry = () => {
    void projects.refetch();
    void brief.refetch();
    void plan.refetch();
    void onboarding.refetch();
  };
  return {
    facts,
    project,
    brief: brief.data,
    plan: plan.data?.plan ?? null,
    error,
    retry,
  };
}
