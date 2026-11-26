import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type {
  MarkableStepKey,
  OnboardingCheck,
  OnboardingStep,
  OnboardingStatus,
} from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { QueryError } from "@/components/Status";
import { MainButton, StepCard } from "@/components/setup/StepCard";
import { useCheckAgain, useMarkStep } from "@/lib/setup-queries";
import { dateTime } from "@/lib/format";
import { isMarkable } from "@andy/domain";

/**
 * A step done in GitHub or the terminal (AI-381), as one card: what to do in one line, each
 * command with the repo filled in and a copy button, the GitHub page where it is done, and what
 * the App read. Steps the App can't read get Mark done, stored and shown as marked by hand. The
 * app never runs a step and never sees a token.
 */

/**
 * Whether Mark done is offered: a hand step; a live step whose read failed; or a `both` step once
 * its live part is done or unreadable. A mark never stands in for a live "not yet".
 */
export function canMark(step: OnboardingStep): boolean {
  if (!isMarkable(step.key)) return false;
  if (step.how === "hand" || step.status === "unknown") return true;
  return step.how === "both" && step.checks.every((c) => c.status === "done");
}

export function StatusBadge({ status }: { status: OnboardingStatus }) {
  if (status === "done") return <Badge variant="success">Done</Badge>;
  if (status === "unknown") return <Badge variant="attention">Can't tell</Badge>;
  return <Badge>Not yet</Badge>;
}

export function CommandLine({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Couldn't copy", description: "Select the command and copy it." });
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-2 py-2 font-mono text-xs whitespace-pre">
          {text}
        </code>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 sm:h-auto"
          aria-label={`Copy: ${label}`}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          <span className="max-sm:sr-only">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
    </div>
  );
}

export function ExternalButton({ label, url }: { label: string; url: string }) {
  return (
    <Button asChild variant="outline" className="h-11 sm:h-9">
      <a href={url} target="_blank" rel="noreferrer noopener">
        {label}
        <ExternalLink aria-hidden className="size-3.5" />
      </a>
    </Button>
  );
}

function CheckRow({ check }: { check: OnboardingCheck }) {
  return (
    <li className="flex items-center justify-between gap-2 p-3">
      <span>
        {check.label}
        {check.detail && (
          <span className="block text-xs text-muted-foreground">{check.detail}</span>
        )}
      </span>
      <StatusBadge status={check.status} />
    </li>
  );
}

/** "Marked by hand" with who, when and Clear mark. */
export function MarkedLine({
  mark,
  pending,
  onClear,
}: {
  mark: NonNullable<OnboardingStep["marked"]>;
  pending: boolean;
  onClear: () => void;
}) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="success">Marked by hand</Badge>
      <span className="text-muted-foreground">
        {mark.by}, {dateTime(mark.at)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 sm:h-8"
        disabled={pending}
        onClick={onClear}
      >
        Clear mark
      </Button>
    </p>
  );
}

export function HandStep({
  projectId,
  step,
  onNext,
}: {
  projectId: string;
  step: OnboardingStep;
  onNext: () => void;
}) {
  const mark = useMarkStep(projectId);
  const again = useCheckAgain(projectId);
  const markable = canMark(step);
  const setMark = (done: boolean) =>
    mark.mutate(
      { step: step.key as MarkableStepKey, done },
      {
        onSuccess: () =>
          toast({
            title: done ? `${step.label}: marked done` : `${step.label}: mark cleared`,
            description: "Stored on the project's setup path.",
          }),
      },
    );
  const done = step.status === "done";
  const main = done ? (
    <MainButton onClick={onNext}>Go to the next step</MainButton>
  ) : step.how === "hand" ? (
    <MainButton onClick={() => setMark(true)} disabled={mark.isPending}>
      Mark done
    </MainButton>
  ) : (
    <MainButton onClick={() => again.mutate()} disabled={again.isPending}>
      Check again
    </MainButton>
  );
  return (
    <StepCard
      step={step.key}
      title={step.label}
      meta={
        step.how === "hand"
          ? "marked by hand"
          : step.how === "both"
            ? "read live, then marked by hand"
            : "read live"
      }
      onSubmit={done ? onNext : step.how === "hand" ? () => setMark(true) : () => again.mutate()}
      hint="The app never runs these steps and never sees a token."
      actions={
        <>
          {step.link && <ExternalButton label={step.link.label} url={step.link.url} />}
          {markable && step.how !== "hand" && !step.marked && (
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
      {step.commands.map((c) => (
        <CommandLine key={c.text} label={c.label} text={c.text} />
      ))}
      {step.checks.length > 0 && (
        <ul
          aria-label="What the App read"
          className="divide-y divide-border rounded-md border border-border text-sm"
        >
          {step.checks.map((c) => (
            <CheckRow key={c.label} check={c} />
          ))}
        </ul>
      )}
      {step.how !== "live" && step.checks.length === 0 && !step.marked && (
        <p className="text-xs text-muted-foreground">
          The GitHub App can't read this setting, so it waits for you to mark it done.
        </p>
      )}
      {step.marked && (
        <MarkedLine mark={step.marked} pending={mark.isPending} onClear={() => setMark(false)} />
      )}
      {mark.error && <QueryError error={mark.error} />}
      {again.error && <QueryError error={again.error} />}
    </StepCard>
  );
}
