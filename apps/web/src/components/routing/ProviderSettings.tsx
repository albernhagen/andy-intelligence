import { useState } from "react";
import { ProviderKey, type ProviderRouting } from "@andy/contracts";
import { Input } from "@/components/ui/input";

const control = "h-11 w-20 text-base tabular-nums sm:h-8 sm:text-sm";

type Providers = Record<ProviderKey, ProviderRouting>;

/**
 * Each provider's switch and quota levels (AI-243: M9.8): on or off, reserve, warn and pause
 * percentages, and google-sub's daily task limit (the only provider that counts tasks). The
 * switch saves at once; a number saves when its field is left (AI-339: `onCommit`).
 */
export function ProviderSettings({
  providers,
  onChange,
  onCommit,
}: {
  providers: Providers;
  onChange: (providers: Providers) => void;
  onCommit: (providers: Providers) => void;
}) {
  const next = (key: ProviderKey, patch: Partial<ProviderRouting>) => ({
    ...providers,
    [key]: { ...providers[key], ...patch },
  });
  const set = (key: ProviderKey, patch: Partial<ProviderRouting>) => onChange(next(key, patch));
  const commit = () => onCommit(providers);
  const pct = (key: ProviderKey, field: "reservePct" | "warnPct" | "pausePct", label: string) => (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <PercentInput
        label={`${key} ${label}`}
        value={providers[key][field]}
        onChange={(v) => set(key, { [field]: v })}
        onBlur={commit}
      />
      %
    </label>
  );
  return (
    <section aria-label="Providers" className="space-y-2">
      <h3 className="text-sm font-medium">Providers</h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {ProviderKey.options.map((key) => {
          const p = providers[key];
          return (
            <li key={key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm">
              <label className="flex min-w-36 items-center gap-2 font-medium max-sm:min-h-11">
                <input
                  type="checkbox"
                  className="size-5 sm:size-4"
                  aria-label={`${key} on`}
                  checked={p.enabled}
                  onChange={(e) => {
                    const changed = next(key, { enabled: e.target.checked });
                    onChange(changed);
                    onCommit(changed);
                  }}
                />
                {key}
                <span className="text-xs font-normal text-muted-foreground">
                  {p.enabled ? "on" : "off"}
                </span>
              </label>
              {pct(key, "reservePct", "reserve")}
              {pct(key, "warnPct", "warn")}
              {pct(key, "pausePct", "pause")}
              {key === "google-sub" && (
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  tasks a day
                  <Input
                    type="number"
                    min={1}
                    aria-label={`${key} daily task limit`}
                    className={`${control} w-24`}
                    placeholder="not set"
                    value={p.dailyTaskLimit ?? ""}
                    onBlur={commit}
                    onChange={(e) =>
                      set(key, {
                        dailyTaskLimit: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A 0–100 field that keeps what is typed. A whole number in range is passed on; anything else
 * (cleared, out of range) is passed on as NaN, so the editor blocks the save and names the
 * field instead of saving the old value or a 0.
 */
function PercentInput({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onBlur: () => void;
}) {
  const [text, setText] = useState(Number.isNaN(value) ? "" : String(value));
  const parsed = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
  return (
    <Input
      type="number"
      min={0}
      max={100}
      aria-label={label}
      aria-invalid={!valid}
      className={`${control} ${valid ? "" : "border-destructive"}`}
      value={text}
      onBlur={onBlur}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        const ok = e.target.value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
        onChange(ok ? n : Number.NaN);
      }}
    />
  );
}
