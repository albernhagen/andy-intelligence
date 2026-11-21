import type { Route, RouteLayer, Ticket } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { useTicketRouting } from "@/lib/queries";
import { LAYER_ORDER_LINE, layerText } from "@/lib/route-layers";

/**
 * Which layer set the ticket's worker, tier and route (AI-282: M9; routing-and-policy.md
 * "Layers"), and why earlier routes were skipped. Read-only: the Worker control and the
 * overrides editor change them.
 */

/** One line naming the four layers, for Settings → Models and project settings. */
export function LayerOrderHint() {
  return <p className="text-xs text-muted-foreground">{LAYER_ORDER_LINE}</p>;
}

const routeText = (r: Route) => `${r.model} (${r.harness}, ${r.provider})`;

function Row(props: {
  label: string;
  value: string;
  src: { layer: RouteLayer; epicKey: string | null; note: string | null };
}) {
  return (
    <li>
      <span className="text-xs text-muted-foreground">{props.label}</span>{" "}
      <span className="text-sm">{props.value}</span>{" "}
      <span className="text-xs text-muted-foreground">
        · {layerText(props.src)}
        {props.src.note ? ` (${props.src.note})` : ""}
      </span>
    </li>
  );
}

export function RouteLayers({ ticket }: { ticket: Ticket }) {
  const query = useTicketRouting({ projectId: ticket.projectId, ticketId: ticket.id });
  if (query.error) return <QueryError error={query.error} />;
  const r = query.data;
  if (!r) return null;
  return (
    <section aria-label="Routing" className="space-y-1">
      <p className="text-xs text-muted-foreground">Routing ({r.step} step)</p>
      <ul className="space-y-0.5">
        <Row label="Worker" value={r.worker.value} src={r.worker} />
        <Row label="Tier" value={r.tier.value} src={r.tier} />
        <Row
          label="Route"
          value={r.route.value ? routeText(r.route.value) : "none can run"}
          src={r.route}
        />
      </ul>
      {r.skipped.length > 0 && (
        <ul aria-label="Skipped routes" className="space-y-0.5 text-xs text-muted-foreground">
          {r.skipped.map((s, i) => (
            <li key={i}>
              Skipped {routeText(s.route)}: {s.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
