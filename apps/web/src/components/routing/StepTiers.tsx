import { useState } from "react";
import { RunStep, TierKey, type RoutingConfig, type StepTier } from "@andy/contracts";
import { Segmented } from "@/components/ui/segmented";
import { STEP_LABELS, TIER_LABELS } from "@/lib/settings-labels";

type Steps = RoutingConfig["steps"];

/** The steps shown before "more steps": the ones Andy changes most. */
const FIRST: readonly RunStep[] = ["refine", "build", "review"];

const TIER_OPTIONS = [
  { value: "by_size" as StepTier, label: "By size" },
  ...TierKey.options.map((t) => ({ value: t as StepTier, label: TIER_LABELS[t].name })),
];

/**
 * Which tier each step uses (AI-376: Models): each step's name and what it does, beside a toggle
 * of By size and the four tiers. By size is the ticket's tier from its size or pin. Refine, build
 * and review show first; the rest open with one button. A changed or just-saved step says so.
 */
export function StepTiers({
  steps,
  edited,
  saved,
  onChange,
}: {
  steps: Steps;
  edited: (step: RunStep) => boolean;
  saved: (step: RunStep) => boolean;
  onChange: (steps: Steps) => void;
}) {
  const [all, setAll] = useState(false);
  const rest = RunStep.options.filter((s) => !FIRST.includes(s));
  // A step with an unsaved change always shows, so the bar never names a hidden row.
  const shown = all
    ? RunStep.options
    : RunStep.options.filter((s) => FIRST.includes(s) || edited(s));
  const hidden = rest.filter((s) => !shown.includes(s));
  return (
    <section aria-label="Steps" className="flex flex-col gap-2">
      <h2 className="font-medium">Steps</h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-raised">
        {shown.map((step) => (
          <li
            key={step}
            aria-label={STEP_LABELS[step].name}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
          >
            <div className="flex min-w-0 flex-1 basis-40 flex-col">
              <span className="flex items-center gap-2 font-medium">
                {STEP_LABELS[step].name}
                {edited(step) ? (
                  <span className="text-xs font-normal text-attention">Edited</span>
                ) : saved(step) ? (
                  <span role="status" className="text-xs font-normal text-muted-foreground">
                    Saved
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">{STEP_LABELS[step].description}</span>
            </div>
            <Segmented
              label={`${STEP_LABELS[step].name} tier`}
              value={steps[step]}
              options={TIER_OPTIONS}
              onChange={(t) => onChange({ ...steps, [step]: t })}
              className="gap-0.5 rounded-md bg-muted p-0.5"
            />
          </li>
        ))}
        {hidden.length > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="flex min-h-11 w-full items-center px-3 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:min-h-9"
            >
              {hidden.length} more steps:{" "}
              {hidden.map((s) => STEP_LABELS[s].name.toLowerCase()).join(", ")}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
