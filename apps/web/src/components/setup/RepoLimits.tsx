import type { RepoLimit } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The repo's limits (AI-381, runbook managed-project.md "Limits"), checked before the first step:
 * each ok, failing (named, with why) or unknown while the App can't read the repo.
 */
export function RepoLimits({ limits, className }: { limits: RepoLimit[]; className?: string }) {
  const failing = limits.filter((l) => l.status === "fails");
  return (
    <section
      aria-label="Repo limits"
      className={cn("space-y-2 rounded-lg border border-border bg-raised p-3", className)}
    >
      <p className="text-sm font-medium">
        {failing.length > 0
          ? `The repo fails ${failing.length === 1 ? "a limit" : `${failing.length} limits`}`
          : limits.some((l) => l.status === "unknown")
            ? "Repo limits: can't read the repo yet"
            : "The repo meets every limit"}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {limits.map((l) => (
          <li key={l.key}>
            <Badge
              variant={l.status === "ok" ? "success" : l.status === "fails" ? "danger" : "default"}
            >
              {l.status === "ok" ? "✓" : l.status === "fails" ? "✗" : "?"} {l.label}
            </Badge>
          </li>
        ))}
      </ul>
      {failing.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-destructive">
          {failing.map((l) => (
            <li key={l.key}>
              {l.label}: {l.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
