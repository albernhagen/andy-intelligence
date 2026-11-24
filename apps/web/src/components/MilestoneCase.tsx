import { useState } from "react";
import { MILESTONE_CASE_LINE_MAX, type MilestoneCase as Case } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { useSetMilestoneCase } from "@/lib/queries";

/**
 * A milestone's case beside its status control (ADR-0149, AI-365): who it serves, the expected
 * return, the cheapest way to test it, and its effort (derived on the server from its tickets).
 * The owner writes or edits it here; each save goes through the milestone route, so the API
 * refuses anyone else and logs the change. With no case it says so, and approving still works.
 */

export interface Effort {
  tickets: number;
  sizes: { S: number; M: number; L: number; unsized: number };
}

const LINES: { key: keyof Case; label: string; hint: string }[] = [
  { key: "serves", label: "Serves", hint: "Who gains from it" },
  { key: "expectedReturn", label: "Expected return", hint: "What they gain, and how you'll know" },
  { key: "cheapestTest", label: "Cheapest test", hint: "How to test it's worth it first" },
];

/** "5 tickets: 2 S, 2 M, 1 unsized"; sizes with none are left out. */
export function effortText({ tickets, sizes }: Effort): string {
  if (tickets === 0) return "No tickets yet";
  const parts = (["S", "M", "L", "unsized"] as const)
    .filter((s) => sizes[s] > 0)
    .map((s) => `${sizes[s]} ${s}`);
  return `${tickets} ${tickets === 1 ? "ticket" : "tickets"}: ${parts.join(", ")}`;
}

export function MilestoneCaseView({
  projectId,
  milestone: m,
}: {
  projectId: string;
  milestone: { id: string; name: string; case: Case | null; effort: Effort };
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-label={`Case for ${m.name}`} className="space-y-2 text-sm">
      {editing ? (
        <CaseForm projectId={projectId} milestone={m} onDone={() => setEditing(false)} />
      ) : m.case ? (
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
          {LINES.map((l) => (
            <div key={l.key} className="contents">
              <dt className="text-muted-foreground">{l.label}</dt>
              <dd className="min-w-0 break-words">{m.case![l.key]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground">No case written yet. You can still approve it.</p>
      )}
      <p>
        <span className="text-muted-foreground">Effort </span>
        {effortText(m.effort)}
      </p>
      {!editing && (
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          {m.case ? "Edit case" : "Write case"}
        </Button>
      )}
    </section>
  );
}

function CaseForm({
  projectId,
  milestone: m,
  onDone,
}: {
  projectId: string;
  milestone: { id: string; name: string; case: Case | null };
  onDone: () => void;
}) {
  const set = useSetMilestoneCase(projectId);
  const [draft, setDraft] = useState<Case>(
    m.case ?? { serves: "", expectedReturn: "", cheapestTest: "" },
  );
  const complete = LINES.every((l) => draft[l.key].trim().length > 0);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) set.mutate({ milestoneId: m.id, case: draft }, { onSuccess: onDone });
      }}
    >
      {LINES.map((l) => (
        <Field key={l.key} label={l.label}>
          <Textarea
            className="min-h-12"
            placeholder={l.hint}
            maxLength={MILESTONE_CASE_LINE_MAX}
            value={draft[l.key]}
            onChange={(e) => setDraft({ ...draft, [l.key]: e.target.value })}
          />
        </Field>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!complete || set.isPending}>
          Save case
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {m.case && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={set.isPending}
            onClick={() => set.mutate({ milestoneId: m.id, case: null }, { onSuccess: onDone })}
          >
            Remove case
          </Button>
        )}
      </div>
      {set.error && <QueryError error={set.error} />}
    </form>
  );
}
