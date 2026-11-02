import { useState } from "react";
import { Size, TicketType, TierKey, type Ticket } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { linesToList } from "@/lib/tickets";
import type { TicketInput } from "@/lib/queries";

export type TicketFormValues = TicketInput & { type: TicketType };

interface Props {
  /** Absent when creating. Type can't change after creation (the API has no field for it). */
  ticket?: Ticket;
  submitLabel: string;
  pending: boolean;
  error?: React.ReactNode;
  onSubmit: (values: TicketFormValues) => void;
  onCancel?: () => void;
}

/** Create/edit form for the fields the Definition of Ready checks (ARCHITECTURE §4.2). */
export function TicketForm({ ticket, submitLabel, pending, error, onSubmit, onCancel }: Props) {
  const [type, setType] = useState<TicketType>(ticket?.type ?? "story");
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [body, setBody] = useState(ticket?.body ?? "");
  const [criteria, setCriteria] = useState(ticket?.acceptanceCriteria.join("\n") ?? "");
  const [assumptions, setAssumptions] = useState(ticket?.assumptions.join("\n") ?? "");
  const [size, setSize] = useState<string>(ticket?.size ?? "");
  const [sizeReason, setSizeReason] = useState(ticket?.sizeReason ?? "");
  const [tier, setTier] = useState<string>(ticket?.tier ?? "");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          type,
          title: title.trim(),
          body,
          acceptanceCriteria: linesToList(criteria),
          assumptions: linesToList(assumptions),
          size: size === "" ? null : Size.parse(size),
          sizeReason: sizeReason.trim() || null,
          tier: tier === "" ? null : TierKey.parse(tier),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Type">
          <Select
            value={type}
            disabled={!!ticket}
            onChange={(e) => setType(TicketType.parse(e.target.value))}
          >
            {TicketType.options.map((t) => (
              <option key={t} value={t}>
                {t}
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
      <Field label="Acceptance criteria (one per line, EARS)">
        <Textarea
          value={criteria}
          placeholder="WHEN … THE SYSTEM SHALL …"
          onChange={(e) => setCriteria(e.target.value)}
        />
      </Field>
      <Field label="Assumptions (one per line)">
        <Textarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)} />
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
            <option value="">—</option>
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
