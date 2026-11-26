import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/Status";
import { BriefStep } from "@/components/setup/BriefStep";
import { ApproveStep, PlanStep } from "@/components/setup/PlanSteps";
import { ExternalButton, HandStep, MarkedLine, canMark } from "@/components/setup/HandStep";
import { RepoLimits } from "@/components/setup/RepoLimits";
import { MainButton, StepCard } from "@/components/setup/StepCard";
import { clearDraft } from "@/lib/brief-draft";
import { useMarkStep, useSetupFacts, useStartRefine } from "@/lib/setup-queries";
import {
  STEP_COUNT,
  canOpen,
  onboardingStep,
  setupSteps,
  stepNumber,
  type SetupStep,
  type SetupStepKey,
} from "@/lib/setup-steps";
import type { ProvingRefine } from "@andy/contracts";
import { cn } from "@/lib/utils";

/**
 * `/p/<project>/setup` (AI-373, AI-381): a new project's path from its repo to the first agent
 * task as one visible sequence: every step of runbook managed-project.md (the GitHub and terminal
 * ones with their commands) plus Brief, Plan and Approve, using direction B's one-step card. The
 * repo's limits sit above the card. Each step ticks itself off from the API's facts, or from a
 * mark Andy stored, never from this browser.
 */
export function SetupPage() {
  const { projectId } = useParams({ from: "/p/$projectId/setup" });
  const navigate = useNavigate();
  const s = useSetupFacts(projectId);
  const [picked, setPicked] = useState<SetupStepKey | null>(null);
  const merged = s.facts?.briefOnDefaultBranch === true;
  // The brief is stored on the default branch: the draft kept in this browser has done its job.
  useEffect(() => {
    if (merged) clearDraft(projectId);
  }, [merged, projectId]);

  if (s.error) return <QueryError error={s.error} what="this project's setup" onRetry={s.retry} />;
  if (!s.facts || !s.project)
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );

  const steps = setupSteps(s.facts);
  const current = steps.find((x) => x.state === "current")?.key ?? null;
  // A done step can be opened to see it; a later one can't be done before its turn.
  const pickedStep = picked ? steps.find((x) => x.key === picked) : undefined;
  const shown = pickedStep && canOpen(pickedStep) ? pickedStep.key : current;
  const toBoard = () => void navigate({ to: "/p/$projectId", params: { projectId } });
  const repo = s.facts.onboarding.repo;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-[14rem_1fr]">
      <nav aria-label={`Set up ${s.project.name}`} className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Set up {s.project.name}</p>
        <ol className="space-y-1 max-sm:hidden">
          {steps.map((step) => (
            <li key={step.key}>
              <StepRow step={step} active={step.key === shown} onPick={() => setPicked(step.key)} />
            </li>
          ))}
        </ol>
        <p className="sm:hidden text-sm font-medium">
          {current
            ? `Step ${stepNumber(current)} of ${STEP_COUNT}: ${steps.find((x) => x.key === current)!.label}`
            : "Setup is done"}
        </p>
        {repo && (
          <p className="text-xs text-muted-foreground max-sm:hidden">Created with repo {repo}.</p>
        )}
      </nav>
      <div className="min-w-0 space-y-3">
        <RepoLimits limits={s.facts.onboarding.limits} />
        <StepBody
          shown={shown}
          projectId={projectId}
          name={s.project.name}
          s={s}
          onBoard={toBoard}
          onNext={() => setPicked(null)}
        />
      </div>
    </div>
  );
}

function StepRow({
  step,
  active,
  onPick,
}: {
  step: SetupStep;
  active: boolean;
  onPick: () => void;
}) {
  const n = stepNumber(step.key);
  return (
    <button
      type="button"
      disabled={!canOpen(step)}
      aria-current={active ? "step" : undefined}
      onClick={onPick}
      className={cn(
        "flex h-11 w-full items-center gap-2 rounded-md border px-2 text-left text-sm sm:h-9",
        "focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-border bg-raised font-medium" : "border-transparent",
        canOpen(step) ? "hover:bg-foreground/5" : "text-muted-foreground",
      )}
    >
      {step.state === "done" ? (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-success text-background">
          <Check className="size-3" aria-hidden />
          <span className="sr-only">Done:</span>
        </span>
      ) : (
        <span
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-full border text-2xs tabular-nums",
            step.state === "current" ? "border-primary text-primary" : "border-border",
          )}
        >
          {n}
        </span>
      )}
      {step.label}
    </button>
  );
}

function StepBody({
  shown,
  projectId,
  name,
  s,
  onBoard,
  onNext,
}: {
  shown: SetupStepKey | null;
  projectId: string;
  name: string;
  s: ReturnType<typeof useSetupFacts>;
  onBoard: () => void;
  onNext: () => void;
}) {
  const facts = s.facts!;
  const plan = s.plan;
  const next = <MainButton onClick={onNext}>Go to the next step</MainButton>;
  switch (shown) {
    case null:
      return (
        <StepCard
          step="builds_on"
          title={`${name} is set up`}
          onSubmit={onBoard}
          actions={<MainButton onClick={onBoard}>Open the board</MainButton>}
        >
          <p className="text-sm">
            Every onboarding step is done, the plan approved and builds on. Ready tickets in
            approved milestones are built from here.
          </p>
          <RefineResult refine={facts.onboarding.refine} />
        </StepCard>
      );
    case "repo_app":
    case "baseline_pr":
    case "repo_settings":
    case "deploy_env":
    case "reusable_workflows":
    case "reviewer_token":
    case "agent_environment":
      return <HandStep projectId={projectId} step={onboardingStep(facts, shown)} onNext={onNext} />;
    case "brief":
      if (facts.briefOnDefaultBranch === true || (plan && plan.status !== "rejected"))
        return (
          <StepCard step="brief" title="The brief is merged" onSubmit={onNext} actions={next}>
            <p className="text-sm">
              <code>docs/product/brief.md</code> is on the default branch. Agents read it as data.
            </p>
          </StepCard>
        );
      if (s.brief && !s.brief.readable)
        return (
          <StepCard
            step="brief"
            title="Can't read the project's repo"
            actions={
              <Button asChild className="h-11 sm:h-9">
                <Link to="/settings/github">Open GitHub settings</Link>
              </Button>
            }
          >
            <p role="alert" className="text-sm text-destructive">
              {s.brief.problem}. The brief is a PR on the repo, so the repo comes first.
            </p>
          </StepCard>
        );
      return (
        <BriefStep
          projectId={projectId}
          projectName={name}
          prefill={s.brief?.prefill ?? {}}
          onDone={onBoard}
        />
      );
    case "plan":
      if (plan && plan.status !== "rejected")
        return (
          <StepCard step="plan" title="The plan arrived" onSubmit={onNext} actions={next}>
            <p className="text-sm">
              {plan.proposal.milestones.length} milestones proposed from the brief.
            </p>
          </StepCard>
        );
      return (
        <PlanStep
          projectId={projectId}
          briefMerged={facts.briefOnDefaultBranch === true}
          rejected={plan?.status === "rejected" ? plan : null}
        />
      );
    case "approve":
      if (plan?.status === "approved")
        return (
          <StepCard step="approve" title="The plan is approved" onSubmit={onNext} actions={next}>
            <p className="text-sm">
              {plan.epicIds.length} milestones are on the roadmap, each with its epic.
            </p>
          </StepCard>
        );
      return plan ? <ApproveStep projectId={projectId} plan={plan} /> : null;
    case "proving_refine":
      return <RefineStep projectId={projectId} facts={facts} onNext={onNext} onBoard={onBoard} />;
    case "builds_on":
      return (
        <BuildsOnStep
          projectId={projectId}
          on={onboardingStep(facts, "builds_on").status === "done"}
        />
      );
  }
}

/** The proving refine's result (runbook step 8): what the newest refine task did. */
function RefineResult({ refine }: { refine: ProvingRefine }) {
  if (refine.status === "none" || refine.status === "unknown") return null;
  const text = {
    running: "A refine task is running",
    succeeded: "The refine succeeded",
    failed: "The last refine failed",
  }[refine.status];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
      <span>
        {text}
        {refine.ticketKey ? ` on ${refine.ticketKey}` : ""}
        {refine.error && <span className="block text-xs text-destructive">{refine.error}</span>}
      </span>
      <Badge
        variant={
          refine.status === "succeeded"
            ? "success"
            : refine.status === "running"
              ? "running"
              : "danger"
        }
      >
        {refine.status === "succeeded"
          ? "Done"
          : refine.status === "running"
            ? "Running"
            : "Failed"}
      </Badge>
    </div>
  );
}

/**
 * Step 10: one refine proves the agent environment's token (runbook step 8). Offers to start it
 * on an Up-next ticket and shows the task's result; read live from the project's agent tasks.
 */
function RefineStep({
  projectId,
  facts,
  onNext,
  onBoard,
}: {
  projectId: string;
  facts: NonNullable<ReturnType<typeof useSetupFacts>["facts"]>;
  onNext: () => void;
  onBoard: () => void;
}) {
  const start = useStartRefine(projectId);
  const mark = useMarkStep(projectId);
  const step = onboardingStep(facts, "proving_refine");
  const setMark = (done: boolean) => mark.mutate({ step: "proving_refine", done });
  const refine = facts.onboarding.refine;
  const candidate = refine.candidate;
  const done = step.status === "done";
  const canStart = !done && refine.status !== "running" && candidate !== null;
  const main = done ? (
    <MainButton onClick={onNext}>Go to the next step</MainButton>
  ) : canStart ? (
    <MainButton onClick={() => start.mutate(candidate.id)} disabled={start.isPending}>
      Start the first refine
    </MainButton>
  ) : (
    <MainButton onClick={onBoard}>Open the board</MainButton>
  );
  return (
    <StepCard
      step="proving_refine"
      title={step.label}
      meta="read live"
      onSubmit={done ? onNext : canStart ? () => start.mutate(candidate.id) : onBoard}
      hint="A refine uses Claude quota: one agent task of a few minutes."
      actions={
        <>
          {refine.url && <ExternalButton label="Open the refine's run" url={refine.url} />}
          {canMark(step) && !step.marked && (
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-9"
              disabled={mark.isPending}
              onClick={() => setMark(true)}
            >
              Mark done
            </Button>
          )}
          {main}
        </>
      }
    >
      <p className="text-sm">{step.instruction}</p>
      {!done && refine.status !== "running" && (
        <p className="text-sm text-muted-foreground">
          {candidate
            ? `It runs on ${candidate.key}: ${candidate.title}.`
            : "No ticket is in Up next yet: move one there on the board (auto-refine then starts it)."}
        </p>
      )}
      <RefineResult refine={refine} />
      {refine.status === "unknown" && (
        <p className="text-sm text-muted-foreground">{step.checks[0]?.detail}</p>
      )}
      {step.marked && (
        <MarkedLine mark={step.marked} pending={mark.isPending} onClear={() => setMark(false)} />
      )}
      {start.error && <QueryError error={start.error} />}
      {mark.error && <QueryError error={mark.error} />}
    </StepCard>
  );
}

/** Step 11: builds on, set in project settings by Andy only (ADR-0063). */
function BuildsOnStep({ projectId, on }: { projectId: string; on: boolean }) {
  const navigate = useNavigate();
  const toSettings = () => void navigate({ to: "/p/$projectId/settings", params: { projectId } });
  return (
    <StepCard
      step="builds_on"
      title="Turn builds on"
      meta="read live"
      onSubmit={toSettings}
      hint="Builds stay off until you turn them on; agent tasks use Claude quota."
      actions={<MainButton onClick={toSettings}>Open build settings</MainButton>}
    >
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        <li className="flex items-center justify-between gap-2 p-3">
          <span>
            Builds on
            <span className="block text-xs text-muted-foreground">
              Agent tasks may build Ready tickets. Set in project settings, by you only.
            </span>
          </span>
          <Badge variant={on ? "success" : "attention"}>{on ? "On" : "Off"}</Badge>
        </li>
      </ul>
    </StepCard>
  );
}
