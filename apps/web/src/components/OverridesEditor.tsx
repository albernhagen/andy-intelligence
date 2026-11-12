import {
  AutonomyLevel,
  TierKey,
  type Route,
  type Ticket,
  type TicketOverrides,
} from "@andy/contracts";
import { TIER_FOR_SIZE, TIER_ROUTES, epicOf, inheritedOverrides } from "@andy/domain";
import { useTicketSave } from "@/components/InlineEdit";
import { Select } from "@/components/ui/input";

/**
 * The ticket's overrides (AI-116): each edits the ticket's own value in place. A value the ticket
 * takes from its epic shows with "from epic AI-n"; picking one sets the ticket's own. The worker
 * (`assignee`) is set by the Worker control above; here it only shows when inherited.
 */

const ROUTES: readonly Route[] = Object.values(TIER_ROUTES);
const routeLabel = (r: Route) => `${r.model} (${r.harness})`;

type Field = "tier" | "modelPin" | "autonomy" | "targetEnv";

interface FieldSpec {
  label: string;
  /** What applies when neither the ticket nor its epic sets it. */
  fallback: (t: Ticket) => string;
  options: (readonly [string, string])[];
  show: (o: TicketOverrides) => string;
  parse: (v: string) => TicketOverrides[Field];
  value: (o: TicketOverrides) => string;
}

const SPECS: Record<Field, FieldSpec> = {
  tier: {
    label: "Tier",
    fallback: (t) => (t.size ? `${TIER_FOR_SIZE[t.size]} (from size)` : "from size"),
    options: TierKey.options.map((v) => [v, `${v} (pinned)`] as const),
    show: (o) => o.tier ?? "",
    parse: (v) => TierKey.parse(v),
    value: (o) => o.tier ?? "",
  },
  modelPin: {
    label: "Model",
    fallback: () => "from tier",
    options: ROUTES.map((r) => [r.model, routeLabel(r)] as const),
    show: (o) => (o.modelPin ? routeLabel(o.modelPin) : ""),
    parse: (v) => ROUTES.find((r) => r.model === v),
    value: (o) => o.modelPin?.model ?? "",
  },
  autonomy: {
    label: "Autonomy",
    fallback: () => "project policy",
    options: AutonomyLevel.options.map((v) => [v, v] as const),
    show: (o) => o.autonomy ?? "",
    parse: (v) => AutonomyLevel.parse(v),
    value: (o) => o.autonomy ?? "",
  },
  targetEnv: {
    label: "Target env",
    fallback: () => "project policy",
    options: [
      ["dev", "dev"],
      ["prod", "prod"],
    ],
    show: (o) => o.targetEnv ?? "",
    parse: (v) => (v === "prod" ? "prod" : "dev"),
    value: (o) => o.targetEnv ?? "",
  },
};

export function OverridesEditor({ ticket, tickets }: { ticket: Ticket; tickets: Ticket[] }) {
  const epic = epicOf(ticket, tickets);
  const inherited = inheritedOverrides(ticket, epic);
  return (
    <section aria-label="Overrides" className="space-y-2">
      <span className="text-xs text-muted-foreground">Overrides</span>
      {epic && inherited.includes("assignee") && (
        <p className="text-xs text-muted-foreground">
          Worker: {epic.overrides.assignee === "me" ? "Andy" : "agent"} (from epic {epic.key})
        </p>
      )}
      {(Object.keys(SPECS) as Field[]).map((field) => (
        <OverrideField
          key={field}
          ticket={ticket}
          field={field}
          epic={epic && inherited.includes(field) ? epic : null}
        />
      ))}
    </section>
  );
}

function OverrideField({
  ticket,
  field,
  epic,
}: {
  ticket: Ticket;
  field: Field;
  /** Set when this field's value comes from the epic. */
  epic: Ticket | null;
}) {
  const spec = SPECS[field];
  const s = useTicketSave(ticket);
  const own = spec.value(ticket.overrides);
  // A pinned model no longer in the route table still shows as itself.
  const extra =
    own && !spec.options.some(([v]) => v === own)
      ? [[own, spec.show(ticket.overrides)] as const]
      : [];
  const save = (v: string) => {
    const rest: TicketOverrides = { ...ticket.overrides };
    delete rest[field];
    const parsed = v === "" ? undefined : spec.parse(v);
    s.save({ overrides: parsed === undefined ? rest : { ...rest, [field]: parsed } });
  };
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{spec.label}</span>
        <Select
          className="h-8"
          value={own}
          disabled={s.pending}
          onChange={(e) => save(e.target.value)}
        >
          <option value="">
            {epic ? `${spec.show(epic.overrides)} (from epic ${epic.key})` : spec.fallback(ticket)}
          </option>
          {[...spec.options, ...extra].map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </label>
      {epic && <p className="text-xs text-muted-foreground">From epic {epic.key}</p>}
      {s.error}
    </div>
  );
}
