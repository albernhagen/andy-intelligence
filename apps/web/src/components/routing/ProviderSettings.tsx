import { ProviderKey, type ProviderRouting } from "@andy/contracts";
import { Input } from "@/components/ui/input";

const control = "h-11 w-20 text-base tabular-nums sm:h-8 sm:text-sm";

type Providers = Record<ProviderKey, ProviderRouting>;

/**
 * Each provider's switch and quota levels (AI-243: M9.8): on or off, reserve, warn and pause
 * percentages, and google-sub's daily task limit (the only provider that counts tasks).
 */
export function ProviderSettings({
  providers,
  onChange,
}: {
  providers: Providers;
  onChange: (providers: Providers) => void;
}) {
  const set = (key: ProviderKey, patch: Partial<ProviderRouting>) =>
    onChange({ ...providers, [key]: { ...providers[key], ...patch } });
  const pct = (key: ProviderKey, field: "reservePct" | "warnPct" | "pausePct", label: string) => (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        min={0}
        max={100}
        aria-label={`${key} ${label}`}
        className={control}
        value={providers[key][field]}
        onChange={(e) => set(key, { [field]: Number(e.target.value) })}
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
              <label className="flex min-w-36 items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  className="size-5 sm:size-4"
                  aria-label={`${key} on`}
                  checked={p.enabled}
                  onChange={(e) => set(key, { enabled: e.target.checked })}
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
