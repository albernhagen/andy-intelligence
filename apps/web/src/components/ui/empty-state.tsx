import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * An empty list or page (AI-369): what is missing, why if it helps, and the one next step
 * (design.md "Copy": "Nothing needs you.").
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  className,
}: {
  /** What is missing, as a sentence: "No tickets in Ready." */
  title: string;
  description?: ReactNode;
  /** The one next step: a button or link. */
  action?: ReactNode;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center",
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-5 text-muted-foreground" />}
      <p className="text-md font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
