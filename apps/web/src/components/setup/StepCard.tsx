import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { STEP_COUNT, stepNumber, type SetupStepKey } from "@/lib/setup-steps";

/**
 * Direction B's one-step-at-a-time card (AI-373, design review 2026-11-23): where the step is, one
 * question as the heading, its controls, then a footer with a hint and the step's buttons.
 * Cmd+Enter (Ctrl+Enter) presses the card's main button, as its key hint says.
 */
export function StepCard({
  step,
  meta,
  title,
  children,
  hint,
  actions,
  onSubmit,
}: {
  step: SetupStepKey;
  /** After "Step N of 5": "about 3 minutes". */
  meta?: string;
  title: string;
  children?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  /** The main button's action, for Cmd+Enter; none when it is disabled. */
  onSubmit?: () => void;
}) {
  return (
    <section
      aria-labelledby={`step-${step}-title`}
      className="flex min-h-96 flex-col gap-4 rounded-lg border border-border bg-raised p-4 sm:p-6"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
          e.preventDefault();
          onSubmit();
        }
      }}
    >
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Step {stepNumber(step)} of {STEP_COUNT}
          {meta ? ` · ${meta}` : ""}
        </p>
        <h2 id={`step-${step}-title`} className="text-lg font-semibold">
          {title}
        </h2>
      </div>
      <div className="flex-1 space-y-3">{children}</div>
      {(hint || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-64 text-xs text-muted-foreground">{hint}</div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      )}
    </section>
  );
}

/** The card's one main button, with its Cmd+Enter hint. */
export function MainButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <Button
      type={type}
      className="h-11 sm:h-9"
      disabled={disabled}
      onClick={onClick}
      aria-keyshortcuts="Meta+Enter Control+Enter"
    >
      {children}
      <Kbd>⌘↵</Kbd>
    </Button>
  );
}
