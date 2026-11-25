import { useId, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * A labelled Radix `Select` for the ticket and epic panels (AI-375: no native select). Radix
 * items can't have an empty value, so "none" ("No type", "No milestone", a value from the epic)
 * travels as `NONE` and comes back to the caller as "".
 */

const NONE = "__none__";

export interface PanelOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
}

export function PanelSelect({
  label,
  value,
  options,
  onValueChange,
  disabled,
  placeholder,
  hideLabel,
  ariaLabel,
  keepFocusOnPick,
}: {
  label: string;
  /** "" picks the option whose value is "" (if any), else shows the placeholder. */
  value: string;
  options: readonly PanelOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Hide the visible label; the trigger keeps it as its name. */
  hideLabel?: boolean;
  /** The trigger's name when it differs from the visible label. */
  ariaLabel?: string;
  /** Leave focus where the pick put it (a field it opened) instead of back on the trigger. */
  keepFocusOnPick?: boolean;
}) {
  const id = useId();
  const hasNone = options.some((o) => o.value === "");
  const toItem = (v: string) => (v === "" ? NONE : v);
  return (
    <div className="space-y-1">
      {!hideLabel && (
        <label htmlFor={id} className="block text-xs text-muted-foreground">
          {label}
        </label>
      )}
      <Select
        value={value === "" && !hasNone ? "" : toItem(value)}
        disabled={disabled}
        onValueChange={(v) => onValueChange(v === NONE ? "" : v)}
      >
        <SelectTrigger id={id} aria-label={ariaLabel ?? label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent onCloseAutoFocus={keepFocusOnPick ? (e) => e.preventDefault() : undefined}>
          {options.map((o) => (
            <SelectItem key={o.value} value={toItem(o.value)} description={o.description}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
