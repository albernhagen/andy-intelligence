import { useState } from "react";
import { Size, TicketType, TierKey, type Ticket } from "@andy/contracts";
import { TIER_FOR_SIZE } from "@andy/domain";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { TYPE_LABELS, linesToList } from "@/lib/tickets";
import type { TicketInput } from "@/lib/queries";

export type TicketFormValues = TicketInput;

interface Props {
  /** Absent when creating. */
  ticket?: Ticket;
  submitLabel: string;
  pending: boolean;
  error?: React.ReactNode;
  onSubmit: (values: TicketFormValues) => void;
  onCancel?: () => void;
}

/**
 * Create/edit form for the fields the Definition of Ready checks (ARCHITECTURE §4.2). A title
 * alone is enough (ADR-0058): refine fills type, size and scope where they are empty.
 */
export function TicketForm({ ticket, submitLabel, pending, error, onSubmit, onCancel }: Props) {
  const [type, setType] = useState<string>(ticket?.type ?? "");
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [body, setBody] = useState(ticket?.body ?? "");
  const [criteria, setCriteria] = useState(ticket?.acceptanceCriteria.join("\n") ?? "");
  const [assumptions, setAssumptions] = useState(ticket?.assumptions.join("\n") ?? "");
  const [size, setSize] = useState<string>(ticket?.size ?? "");
  const [sizeReason, setSizeReason] = useState(ticket?.sizeReason ?? "");
  const [outOfScope, setOutOfScope] = useState(ticket?.outOfScope.join("\n") ?? "");
  const [touches, setTouches] = useState(ticket?.touches.join("\n") ?? "");
  const [tier, setTier] = useState<string>(ticket?.overrides.tier ?? "");
  const derived = size === "" ? null : TIER_FOR_SIZE[Size.parse(size)];

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const overrides = { ...ticket?.overrides };
        delete overrides.tier;
        onSubmit({
          type: type === "" ? null : TicketType.parse(type),
          title: title.trim(),
          body,
          acceptanceCriteria: linesToList(criteria),
          assumptions: linesToList(assumptions),
          size: size === "" ? null : Size.parse(size),
          sizeReason: sizeReason.trim() || null,
          outOfScope: linesToList(outOfScope),
          touches: linesToList(touches),
          // Tier comes from size; choosing one pins it (`overrides.tier`).
          overrides: tier === "" ? overrides : { ...overrides, tier: TierKey.parse(tier) },
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">—</option>
            {TicketType.options.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <Field label="Problem / intent">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label="Acceptance criteria (one per line; features: “… shall …”)">
        <Textarea
          value={criteria}
          placeholder="WHEN … the system shall …"
          onChange={(e) => setCriteria(e.target.value)}
        />
      </Field>
      <Field label="Assumptions (one per line)">
        <Textarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)} />
      </Field>
      <Field label="Out of scope (one per line)">
        <Textarea value={outOfScope} onChange={(e) => setOutOfScope(e.target.value)} />
      </Field>
      <Field label="Touches (areas or path globs, one per line)">
        <Textarea value={touches} onChange={(e) => setTouches(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_10rem]">
        <Field label="Size">
          <Select value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">—</option>
            {Size.options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Size reason">
          <Input value={sizeReason} onChange={(e) => setSizeReason(e.target.value)} />
        </Field>
        <Field label="Tier">
          <Select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">{derived ? `${derived} (from size)` : "from size"}</option>
            {TierKey.options.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !title.trim()}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
