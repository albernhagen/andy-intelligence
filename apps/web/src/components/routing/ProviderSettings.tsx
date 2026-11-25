import { useState } from "react";
import { ProviderKey, type ProviderRouting } from "@andy/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_LABELS } from "@/lib/settings-labels";
import { count } from "@/lib/format";

const control = "h-11 w-20 text-base tabular-nums sm:h-8 sm:text-sm";

type Providers = Record<ProviderKey, ProviderRouting>;

/** A percentage being typed may be NaN until it is a whole number. */
const pct = (n: number) => (Number.isNaN(n) ? "?" : `${n}`);

/** A provider's state in one line: "Warn at 70%, pause at 80%, keep 20% in reserve" or "Off". */
export function providerSummary(key: ProviderKey, p: ProviderRouting): string {
  const paid = PROVIDER_LABELS[key].paid ? " · paid, counts against spend caps" : "";
  if (!p.enabled) return `Off${paid}`;
  const levels = `Warn at ${pct(p.warnPct)}%, pause at ${pct(p.pausePct)}%`;
  const reserve = p.reservePct !== 0 ? `, keep ${pct(p.reservePct)}% in reserve` : "";
  const daily = p.dailyTaskLimit === null ? "" : `, at most ${count(p.dailyTaskLimit)} tasks a day`;
  return `${levels}${reserve}${daily}${paid}`;
}

/**
 * Each provider as a row (AI-376: Models): a switch with its plain name, its levels in a line,
 * and Edit to change the reserve, warn and pause percentages (and google-sub's daily task
 * limit, the only provider that counts tasks). Every change waits in the save bar.
 */
export function ProviderSettings({
  providers,
  edited,
  saved,
  onChange,
}: {
  providers: Providers;
  edited: (key: ProviderKey) => boolean;
  saved: (key: ProviderKey) => boolean;
  onChange: (providers: Providers) => void;
}) {
  const [open, setOpen] = useState<ProviderKey | null>(null);
  const set = (key: ProviderKey, patch: Partial<ProviderRouting>) =>
    onChange({ ...providers, [key]: { ...providers[key], ...patch } });
  return (
    <section aria-label="Providers" className="flex flex-col gap-2">
      <h2 className="font-medium">Providers</h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-raised">
        {ProviderKey.options.map((key) => {
          const p = providers[key];
          const name = PROVIDER_LABELS[key].name;
          return (
            <li key={key} aria-label={name} className="flex flex-col gap-2 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <Switch
                  aria-label={`${name} on`}
                  checked={p.enabled}
                  onCheckedChange={(enabled) => set(key, { enabled })}
                  label={
                    <span className="flex items-center gap-2">
                      {name}
                      {edited(key) ? (
                        <span className="text-xs font-normal text-attention">Edited</span>
                      ) : saved(key) ? (
                        <span role="status" className="text-xs font-normal text-muted-foreground">
                          Saved
                        </span>
                      ) : null}
                    </span>
                  }
                  description={providerSummary(key, p)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 shrink-0 px-2 text-muted-foreground sm:h-7"
                  aria-expanded={open === key}
                  aria-label={`Edit ${name} levels`}
                  onClick={() => setOpen(open === key ? null : key)}
                >
                  {open === key ? "Close" : "Edit"}
                </Button>
              </div>
              {open === key && (
                <div className="flex flex-wrap gap-x-4 gap-y-2 pl-9">
                  <PercentField
                    label={`${name} reserve`}
                    text="Keep in reserve"
                    value={p.reservePct}
                    onChange={(v) => set(key, { reservePct: v })}
                  />
                  <PercentField
                    label={`${name} warn`}
                    text="Warn at"
                    value={p.warnPct}
                    onChange={(v) => set(key, { warnPct: v })}
                  />
                  <PercentField
                    label={`${name} pause`}
                    text="Pause at"
                    value={p.pausePct}
                    onChange={(v) => set(key, { pausePct: v })}
                  />
                  {key === "google-sub" && (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      Tasks a day
                      <Input
                        type="number"
                        min={1}
                        aria-label={`${name} daily task limit`}
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
                </div>
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
function PercentField({
  label,
  text,
  value,
  onChange,
}: {
  label: string;
  text: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [typed, setTyped] = useState(Number.isNaN(value) ? "" : String(value));
  const parsed = Number(typed);
  const valid = typed.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {text}
      <Input
        type="number"
        min={0}
        max={100}
        aria-label={label}
        aria-invalid={!valid}
        className={`${control} ${valid ? "" : "border-destructive"}`}
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          const n = Number(e.target.value);
          const ok = e.target.value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
          onChange(ok ? n : Number.NaN);
        }}
      />
      %
    </label>
  );
}
