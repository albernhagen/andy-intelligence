import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One form field (AI-368): label, help, error and saved cue around one control. The control gets
 * the field's `id`, `aria-describedby` (help, error) and `aria-invalid`, so any control works:
 * `Input`, `SelectTrigger`, `Switch`, `Checkbox`. Every write confirms in place (design.md
 * "Feedback"): `error` shows the API's message, `saved` the time it was saved.
 */
export function Field({
  label,
  help,
  error,
  saved,
  className,
  children,
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  /** The API's message for a failed write; marks the control invalid. */
  error?: React.ReactNode;
  /** Shown after a successful write: `true` reads "Saved", or pass "Saved · 2:50 PM". */
  saved?: React.ReactNode;
  className?: string;
  /** Exactly one control element. */
  children: React.ReactElement;
}) {
  const id = React.useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className={cn("space-y-1 text-sm", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <span aria-live="polite" className="text-xs text-success">
          {saved && !error ? (
            <span className="inline-flex items-center gap-1">
              <Check className="size-3" aria-hidden />
              {saved === true ? "Saved" : saved}
            </span>
          ) : null}
        </span>
      </div>
      <Slot
        id={id}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
      >
        {children}
      </Slot>
      {help ? (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
