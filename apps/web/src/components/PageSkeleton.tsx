import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A page's first read loading (AI-378): rows in the shape of the list to come. Screen readers
 * hear "Loading"; the bars themselves are hidden from them.
 */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("space-y-2 rounded-lg border border-border bg-raised p-3", className)}
    >
      <Skeleton className="h-4 w-40" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-8", i % 2 ? "w-5/6" : "w-full")} />
      ))}
    </div>
  );
}

/** Cards in a grid, for a dashboard's tiles and charts. */
export function CardsSkeleton({ cards = 4, className }: { cards?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}
    >
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border bg-raised p-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
