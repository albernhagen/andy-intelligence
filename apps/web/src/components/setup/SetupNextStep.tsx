import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useSetupFacts } from "@/lib/setup-queries";
import { STEP_COUNT, nextStep, showsSetupBar, stepNumber } from "@/lib/setup-steps";

/**
 * The board's setup bar (AI-373): while a new project has unfinished setup steps, which one is
 * next and one button that opens it. Only for a project with no story tickets yet (`storyCount`),
 * so projects already being built never read the setup facts or show it.
 */
export function SetupNextStep({
  projectId,
  storyCount,
}: {
  projectId: string;
  storyCount: number;
}) {
  const s = useSetupFacts(projectId, storyCount === 0);
  if (storyCount > 0 || !s.facts || !s.project) return null;
  if (!showsSetupBar(storyCount, s.facts)) return null;
  const step = nextStep(s.facts)!;
  return (
    <section
      aria-label="Setup"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-raised px-3 py-2"
    >
      <p className="text-sm">
        <span className="text-muted-foreground">
          Set up {s.project.name} · step {stepNumber(step.key)} of {STEP_COUNT}:
        </span>{" "}
        <span className="font-medium">{step.label}</span>
      </p>
      <Button asChild size="sm" className="h-11 sm:h-8">
        <Link to="/p/$projectId/setup" params={{ projectId }}>
          {step.label}
        </Link>
      </Button>
    </section>
  );
}
