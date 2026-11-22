import { RunStep, StepTier, TierKey, type RoutingConfig } from "@andy/contracts";
import { Select } from "@/components/ui/input";

type Steps = RoutingConfig["steps"];

/** Which tier each step uses (AI-243: M9.8); `by_size` is the ticket's tier from its size or pin. */
export function StepTiers({ steps, onChange }: { steps: Steps; onChange: (steps: Steps) => void }) {
  return (
    <section aria-label="Steps" className="space-y-2">
      <h3 className="text-sm font-medium">Steps</h3>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {RunStep.options.map((step) => (
          <li key={step}>
            {/* The label sits beside its select (AI-339), in a column wide enough for the longest step. */}
            <label className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0">{step}</span>
              <Select
                aria-label={`${step} tier`}
                className="h-11 w-32 text-base sm:h-8 sm:text-sm"
                value={steps[step]}
                onChange={(e) => onChange({ ...steps, [step]: StepTier.parse(e.target.value) })}
              >
                {[...TierKey.options, "by_size" as const].map((t) => (
                  <option key={t} value={t}>
                    {t === "by_size" ? "by size" : t}
                  </option>
                ))}
              </Select>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
