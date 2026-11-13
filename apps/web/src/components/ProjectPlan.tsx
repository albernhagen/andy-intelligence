import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectPlan as Plan } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/Status";
import { unwrap, useApi } from "@/lib/api";

/**
 * Project plans (AI-108, AI-65): a new project's milestones, proposed from the plan-project
 * procedure, wait here and in the Needs-you inbox until Andy approves (one epic per milestone)
 * or rejects with a reason. All plan text is untrusted: shown as plain text, never markdown.
 */

/** The project's plan on its settings page: none yet, waiting (with the decision), or decided. */
export function ProjectPlanPanel({ projectId }: { projectId: string }) {
  const api = useApi();
  const plan = useQuery({
    queryKey: ["project-plan", projectId],
    queryFn: async () =>
      unwrap(await api.GET("/api/projects/{projectId}/plan", { params: { path: { projectId } } })),
  });
  if (plan.error) return <QueryError error={plan.error} />;
  const current = plan.data?.plan;
  if (plan.data === undefined) return null;
  return (
    <section aria-label="Project plan" className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">Project plan</h3>
      {current === null || current === undefined ? (
        <p className="text-sm text-muted-foreground">
          Plan needed: no milestones yet. Run platform/procedures/plan-project.md and submit the
          result with MCP submit_project_plan.
        </p>
      ) : current.status === "proposed" || current.status === "approving" ? (
        <WaitingPlan projectId={projectId} plan={current} />
      ) : current.status === "approved" ? (
        <p className="text-sm">Approved: {current.epicIds.length} epics created.</p>
      ) : (
        <p className="text-sm">
          Rejected: <span className="whitespace-pre-wrap">{current.reason}</span>. Submit a new plan
          with MCP submit_project_plan.
        </p>
      )}
    </section>
  );
}

/** Plans waiting for Andy (every project's, or one project's), for the inbox and its count. */
export function useWaitingPlans(projectId?: string) {
  const api = useApi();
  const waiting = useQuery({
    queryKey: ["project-plans-waiting"],
    queryFn: async () => unwrap(await api.GET("/api/project-plans/waiting")),
  });
  const shown = (waiting.data ?? []).filter((w) => !projectId || w.projectId === projectId);
  return { shown, error: waiting.error };
}

/** Every project's waiting plan, for the inbox; with `projectId`, only that project's. */
export function ProjectPlansWaiting({ projectId }: { projectId?: string }) {
  const { shown, error } = useWaitingPlans(projectId);
  if (error) return <QueryError error={error} />;
  if (shown.length === 0) return null;
  return (
    <section aria-label="Project plans" className="space-y-2">
      {shown.map((w) => (
        <article key={w.projectId} className="space-y-2 rounded-md border border-border p-3">
          <h3 className="text-sm font-medium">
            {w.key}: {w.name}: plan waiting for you
          </h3>
          <WaitingPlan projectId={w.projectId} plan={w.plan} />
        </article>
      ))}
    </section>
  );
}

/** A proposed plan's milestones in order, with Approve and Reject (a reason is required). */
function WaitingPlan({ projectId, plan }: { projectId: string; plan: Plan }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const approving = plan.status === "approving";
  const total = plan.proposal.milestones.length;
  const decide = useMutation({
    mutationFn: async (body: { decision: "approved" } | { decision: "rejected"; reason: string }) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/plan/decision", {
          params: { path: { projectId } },
          body,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <div className="space-y-2 text-sm">
      <p className="whitespace-pre-wrap">{plan.proposal.summary}</p>
      <ol aria-label="Milestones" className="list-decimal space-y-1 pl-5">
        {plan.proposal.milestones.map((m, i) => (
          <li key={i}>
            <span className="font-medium">{m.title}</span>: {m.goal}
            <span className="block text-xs text-muted-foreground">
              Done when: {m.doneWhen.join("; ")}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ decision: "approved" })}
        >
          {approving
            ? `Finish approval: ${plan.epicIds.length} of ${total} epics created`
            : `Approve: create ${total} epics`}
        </Button>
        {!approving && (
          <RejectControls
            decide={(r) => decide.mutate({ decision: "rejected", reason: r })}
            pending={decide.isPending}
          />
        )}
      </div>
      {decide.error && <QueryError error={decide.error} />}
    </div>
  );
}

/** A rejection needs a reason; only before approval starts. */
function RejectControls({
  decide,
  pending,
}: {
  decide: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <>
      <input
        aria-label="Reason to reject"
        className="min-w-48 flex-1 rounded-md border border-border px-2 py-1"
        placeholder="Why reject? (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || reason.trim() === ""}
        onClick={() => decide(reason.trim())}
      >
        Reject
      </Button>
    </>
  );
}
