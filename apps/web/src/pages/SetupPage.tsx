import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/Status";
import { BriefStep } from "@/components/setup/BriefStep";
import { ApproveStep, PlanStep } from "@/components/setup/PlanSteps";
import { MainButton, StepCard } from "@/components/setup/StepCard";
import { useSetupFacts } from "@/lib/setup-queries";
import {
  STEP_COUNT,
  setupSteps,
  stepNumber,
  type SetupStep,
  type SetupStepKey,
} from "@/lib/setup-steps";
import { cn } from "@/lib/utils";

/**
 * `/p/<project>/setup` (AI-373): a new project's path from create to first build as one visible
 * sequence (Brief, Plan, Approve milestones, Build), using direction B's one-step card. The list
 * shows every step; the card does the current one. Each step ticks itself off from the API's
 * facts, never from this browser.
 */
export function SetupPage() {
  const { projectId } = useParams({ from: "/p/$projectId/setup" });
  const navigate = useNavigate();
  const s = useSetupFacts(projectId);
  const [picked, setPicked] = useState<SetupStepKey | null>(null);

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
  const shown = picked && steps.find((x) => x.key === picked)?.state !== "todo" ? picked : current;
  const toBoard = () => void navigate({ to: "/p/$projectId", params: { projectId } });
  const repo = s.checklist?.repo ?? null;

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
      <StepBody
        shown={shown}
        projectId={projectId}
        name={s.project.name}
        repo={repo}
        s={s}
        onBoard={toBoard}
        onNext={() => setPicked(null)}
      />
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
      disabled={step.state === "todo"}
      aria-current={active ? "step" : undefined}
      onClick={onPick}
      className={cn(
        "flex h-11 w-full items-center gap-2 rounded-md border px-2 text-left text-sm sm:h-9",
        "focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-border bg-raised font-medium" : "border-transparent",
        step.state === "todo" ? "text-muted-foreground" : "hover:bg-foreground/5",
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
  repo,
  s,
  onBoard,
  onNext,
}: {
  shown: SetupStepKey | null;
  projectId: string;
  name: string;
  repo: string | null;
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
          step="build"
          title={`${name} is set up`}
          onSubmit={onBoard}
          actions={<MainButton onClick={onBoard}>Open the board</MainButton>}
        >
          <p className="text-sm">
            The brief is merged, the plan approved, the baseline in and builds on. Ready tickets in
            approved milestones are built from here.
          </p>
        </StepCard>
      );
    case "create":
      return (
        <StepCard step="create" title="Project created" onSubmit={onNext} actions={next}>
          <p className="text-sm">
            {repo ? `${name} uses repo ${repo}.` : `${name} has no repo yet: add one in settings.`}
          </p>
        </StepCard>
      );
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
    case "build":
      return (
        <BuildStep
          projectId={projectId}
          baselineMerged={facts.baselineMerged}
          buildEnabled={facts.buildEnabled}
        />
      );
  }
}

/** Step 5: the baseline PR merged and builds on; both are checked from the API. */
function BuildStep({
  projectId,
  baselineMerged,
  buildEnabled,
}: {
  projectId: string;
  baselineMerged: boolean;
  buildEnabled: boolean;
}) {
  const navigate = useNavigate();
  const toSettings = () => void navigate({ to: "/p/$projectId/settings", params: { projectId } });
  return (
    <StepCard
      step="build"
      title="Baseline and first build"
      onSubmit={toSettings}
      hint="Builds stay off until you turn them on; agent tasks use Claude quota."
      actions={<MainButton onClick={toSettings}>Open build settings</MainButton>}
    >
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        <li className="flex items-center justify-between gap-2 p-3">
          <span>
            Baseline merged
            <span className="block text-xs text-muted-foreground">
              The managed CI, review and rule files: a PR the App opened on the repo when the
              project was created. You merge it.
            </span>
          </span>
          <Badge variant={baselineMerged ? "success" : "attention"}>
            {baselineMerged ? "Done" : "Missing"}
          </Badge>
        </li>
        <li className="flex items-center justify-between gap-2 p-3">
          <span>
            Builds on
            <span className="block text-xs text-muted-foreground">
              Agent tasks may build Ready tickets. Set in project settings, by you only.
            </span>
          </span>
          <Badge variant={buildEnabled ? "success" : "attention"}>
            {buildEnabled ? "On" : "Off"}
          </Badge>
        </li>
      </ul>
    </StepCard>
  );
}
