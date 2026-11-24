import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ProjectPlan, Run } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { QueryError } from "@/components/Status";
import { toast } from "@/components/ui/toast";
import { useApprovePlan, useSendBackPlan, useStartPlanTask } from "@/lib/setup-queries";
import { MainButton, StepCard } from "./StepCard";

/**
 * Steps 3 and 4 (AI-373): start the plan-project agent task, then approve its milestones, each
 * one approved or parked. All plan text is untrusted: plain text, never markdown.
 */

/** Step 3: a plan-project agent task reads the merged brief and proposes milestones. */
export function PlanStep({
  projectId,
  briefMerged,
  rejected,
}: {
  projectId: string;
  briefMerged: boolean;
  /** The plan Andy sent back, so the step says why a new one is needed. */
  rejected: ProjectPlan | null;
}) {
  const start = useStartPlanTask(projectId);
  const [run, setRun] = useState<Run | null>(null);
  const go = () => start.mutate(undefined, { onSuccess: setRun });
  if (run)
    return (
      <StepCard
        step="plan"
        meta="the plan agent is working"
        title="Planning milestones from your brief"
        hint="This step ticks itself off when the plan arrives; it waits in your inbox too."
        actions={
          <Button asChild variant="outline" className="h-11 sm:h-9">
            <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }}>
              Watch the agent task
            </Link>
          </Button>
        }
      >
        <p className="text-sm">
          Agent task · plan-project started. It reads the brief and proposes milestones, each with
          its case; you approve them in the next step.
        </p>
      </StepCard>
    );
  return (
    <StepCard
      step="plan"
      meta="a few minutes, on Claude quota"
      title="Plan milestones"
      onSubmit={briefMerged && !start.isPending ? go : undefined}
      hint={
        briefMerged
          ? "Uses Claude quota. One plan-project task at a time."
          : "Merge the brief PR first: the plan agent reads the brief from the default branch."
      }
      actions={
        <MainButton onClick={go} disabled={!briefMerged || start.isPending}>
          Start the plan agent
        </MainButton>
      }
    >
      {rejected ? (
        <p className="text-sm">
          You sent the last plan back:{" "}
          <span className="whitespace-pre-wrap">{rejected.reason}</span>. A new plan-project task
          plans again from the brief.
        </p>
      ) : (
        <p className="text-sm">
          A plan-project agent task reads the brief and proposes milestones in order, each with who
          it serves, its expected return and the cheapest test. Nothing is created until you
          approve.
        </p>
      )}
      {start.error && <QueryError error={start.error} />}
    </StepCard>
  );
}

type Choice = "approve" | "park";

/** "Approve 2, park 1": the main button says exactly what it will do. */
export function approveLabel(choices: readonly Choice[]): string {
  const parked = choices.filter((c) => c === "park").length;
  const approved = choices.length - parked;
  return parked === 0 ? `Approve ${approved}` : `Approve ${approved}, park ${parked}`;
}

/** Step 4: each milestone approved or parked, or the whole plan sent back with a note. */
export function ApproveStep({ projectId, plan }: { projectId: string; plan: ProjectPlan }) {
  const milestones = plan.proposal.milestones;
  const [choices, setChoices] = useState<Choice[]>(() => milestones.map(() => "approve"));
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const approve = useApprovePlan(projectId);
  const sendBack = useSendBackPlan(projectId);
  const resuming = plan.status === "approving";
  const busy = approve.isPending || sendBack.isPending;
  const go = () => {
    const parked = choices.flatMap((c, i) => (c === "park" ? [i] : []));
    approve.mutate(
      { plan, parked },
      {
        onSuccess: (r) =>
          toast({
            title: `Approved ${milestones.length - r.parked.length} milestones`,
            description:
              r.parked.length > 0
                ? `Parked on the roadmap: ${r.parked.join(", ")}.`
                : "Each is on the roadmap with its epic.",
          }),
      },
    );
  };

  return (
    <StepCard
      step="approve"
      meta={`the plan agent proposed ${milestones.length} milestones from your brief`}
      title="Approve the plan"
      onSubmit={busy ? undefined : go}
      actions={
        <>
          {!resuming && !noting && (
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setNoting(true)}>
              Send back with a note
            </Button>
          )}
          <MainButton onClick={go} disabled={busy || noting}>
            {resuming
              ? `Finish approval: ${plan.epicIds.length} of ${milestones.length} done`
              : approveLabel(choices)}
          </MainButton>
        </>
      }
      hint={
        plan.proposal.summary ? (
          <span className="whitespace-pre-wrap">{plan.proposal.summary}</span>
        ) : undefined
      }
    >
      <ol
        aria-label="Milestones"
        className="divide-y divide-border rounded-md border border-border"
      >
        {milestones.map((m, i) => (
          <li key={i} className="flex flex-wrap items-start justify-between gap-2 p-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-medium">
                M{i + 1}: {m.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {m.goal} {m.slices.length} tickets.
              </p>
              {m.case && (
                // ADR-0149: approving the plan approves its milestones, so each case shows here.
                <p className="text-xs text-muted-foreground">
                  Serves: {m.case.serves}. Expected return: {m.case.expectedReturn} Cheapest test:{" "}
                  {m.case.cheapestTest}
                </p>
              )}
            </div>
            {!resuming && (
              <Segmented
                label={`M${i + 1}: ${m.title}`}
                value={choices[i]!}
                options={[
                  { value: "approve", label: "Approve" },
                  { value: "park", label: "Park" },
                ]}
                onChange={(c) => setChoices((all) => all.map((x, j) => (j === i ? c : x)))}
                className="rounded-md border border-border p-0.5"
              />
            )}
          </li>
        ))}
      </ol>
      {noting && (
        <div className="space-y-2">
          <Field label="What should the next plan change?">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="text-base sm:text-sm"
              rows={3}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setNoting(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              disabled={busy || note.trim() === ""}
              onClick={() =>
                sendBack.mutate(note.trim(), {
                  onSuccess: () => toast({ title: "Sent the plan back with your note" }),
                })
              }
            >
              Send back
            </Button>
          </div>
        </div>
      )}
      {approve.error && <QueryError error={approve.error} />}
      {sendBack.error && <QueryError error={sendBack.error} />}
    </StepCard>
  );
}
