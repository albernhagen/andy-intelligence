import type { ConfigChange } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { useRevertRoutingChange, useRoutingChanges } from "@/lib/queries";

/**
 * Global routing's change log (AI-275): what each save changed, who, when and why, with Revert.
 * A revert writes the before values back through the normal save (validated and logged as a new
 * change); it is refused, with the reason, when a later change touched the same parts. A
 * project's routing changes are in its settings page's Changes list.
 */
export function RoutingChanges({ onReverted }: { onReverted: () => void }) {
  const changes = useRoutingChanges();
  const revert = useRevertRoutingChange();
  return (
    <section aria-label="Global changes" className="space-y-2">
      <h3 className="text-sm font-medium">Changes</h3>
      {changes.isError && <QueryError error={changes.error} />}
      {revert.error && <QueryError error={revert.error} />}
      {changes.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No global routing changes yet.</p>
      )}
      {changes.data && changes.data.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {changes.data.map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              reverting={revert.isPending}
              onRevert={() => revert.mutate(c.id, { onSuccess: onReverted })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeRow({
  change,
  reverting,
  onRevert,
}: {
  change: ConfigChange;
  reverting: boolean;
  onRevert: () => void;
}) {
  return (
    <li aria-label={`Change ${change.id}`} className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p>Routing: {Object.keys(change.diff).join(", ")} changed</p>
        <p className="text-xs text-muted-foreground">
          {change.actor === "andy" ? "Andy" : change.actor} ·{" "}
          {new Date(change.createdAt).toLocaleString()}
          {change.reason && ` · ${change.reason}`}
        </p>
      </div>
      {change.status === "applied" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 sm:h-8"
          disabled={reverting}
          onClick={onRevert}
        >
          Revert
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">
          {change.status === "reverted" ? "Reverted" : change.status}
        </span>
      )}
    </li>
  );
}
