import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

/**
 * OptionCards (AI-368): a radio group that shows every option with its description, for pickers
 * with fewer than six options (design.md "Form components"; six or more: `Select`). Arrow keys move
 * and pick, like any radio group. `OptionTable` is the variant for options that differ on two
 * facts (merge mode: what merges on its own, what waits for you).
 */

export interface OptionCard<T extends string> {
  value: T;
  label: React.ReactNode;
  description: React.ReactNode;
  /** A marker beside the label, e.g. a "Suggested" badge. */
  badge?: React.ReactNode;
  disabled?: boolean;
}

interface GroupProps<T extends string> {
  /** The group's accessible name, e.g. "Merge mode". */
  label: string;
  value: T | undefined;
  onValueChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

const item =
  "rounded-md border border-border bg-raised text-left text-sm text-foreground outline-none transition-colors duration-[var(--motion-fast)] " +
  "hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:opacity-50 data-[state=checked]:border-selected-edge data-[state=checked]:bg-selected";

/** The radio dot: an empty ring, filled when picked. */
function Dot() {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border bg-background group-data-[state=checked]:border-selected-edge"
    >
      <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-selected-edge" />
    </span>
  );
}

export function OptionCards<T extends string>({
  label,
  value,
  onValueChange,
  options,
  disabled,
  className,
  ...aria
}: GroupProps<T> & { options: readonly OptionCard<T>[] }) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      disabled={disabled}
      className={cn("grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]", className)}
      {...aria}
    >
      {options.map((o) => (
        <RadioGroupPrimitive.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(item, "group flex min-h-11 items-start gap-2 p-3")}
        >
          <span className="flex h-5 items-center">
            <Dot />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 font-medium">
              {o.label}
              {o.badge}
            </span>
            <span className="text-xs text-muted-foreground">{o.description}</span>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

export interface OptionRow<T extends string> {
  value: T;
  label: React.ReactNode;
  /** One cell per column, in column order. */
  facts: readonly [React.ReactNode, React.ReactNode];
  disabled?: boolean;
}

/**
 * The table variant: one row per option, a column per fact. On a phone each row stacks and names
 * its facts, so nothing scrolls sideways.
 */
export function OptionTable<T extends string>({
  label,
  value,
  onValueChange,
  options,
  columns,
  optionHeading = "Option",
  disabled,
  className,
  ...aria
}: GroupProps<T> & {
  options: readonly OptionRow<T>[];
  /** The two facts' headings, e.g. ["Merges on its own", "Waits for you"]. */
  columns: readonly [string, string];
  optionHeading?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      disabled={disabled}
      className={cn("grid gap-1 sm:grid-cols-[auto_minmax(7rem,auto)_1fr_1fr]", className)}
      {...aria}
    >
      {/* Headings for sighted readers; each row names its facts for screen readers and phones. */}
      <div
        aria-hidden
        className="hidden px-3 text-xs text-muted-foreground sm:col-span-4 sm:grid sm:grid-cols-subgrid sm:gap-x-3"
      >
        <span />
        <span>{optionHeading}</span>
        <span>{columns[0]}</span>
        <span>{columns[1]}</span>
      </div>
      {options.map((o) => (
        <RadioGroupPrimitive.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(
            item,
            "group grid min-h-11 grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-3 py-2 sm:col-span-4 sm:grid-cols-subgrid sm:items-center",
          )}
        >
          <span className="flex h-5 items-center">
            <Dot />
          </span>
          <span className="font-medium">{o.label}</span>
          {o.facts.map((fact, i) => (
            <span key={columns[i]} className="col-start-2 sm:col-start-auto">
              <span className="text-xs text-muted-foreground sm:sr-only">{columns[i]}: </span>
              {fact}
            </span>
          ))}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
