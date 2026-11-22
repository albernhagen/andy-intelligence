import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
}

/**
 * A toggle that picks one view (AI-333: design.md "Toggles"). The picked option is `bg-muted`
 * with `aria-pressed`, like the current nav link; `primary` stays for the one main action.
 */
export function Segmented<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** The group's accessible name, e.g. "Weeks". */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1", className)}>
      {options.map((o) => {
        const picked = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={picked}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm sm:h-8",
              "focus-visible:outline-2 focus-visible:outline-ring",
              picked
                ? "bg-muted font-medium text-foreground"
                : // Hover is a lighter tint than the picked option's, so the two never look alike.
                  "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
