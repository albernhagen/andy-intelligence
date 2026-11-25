import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Switch on Radix (AI-368): an on/off setting that applies at once. With `label`, the
 * whole row is the target (44 px on a phone); without one, put it in a `Field` or a labelled row.
 */
export function Switch({
  className,
  label,
  description,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  label?: React.ReactNode;
  description?: React.ReactNode;
}) {
  const control = (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-border p-0.5 transition-colors duration-[var(--motion-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3 rounded-full bg-raised shadow-sm transition-transform duration-[var(--motion-fast)] data-[state=checked]:translate-x-3" />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return <ControlRow control={control} label={label} description={description} />;
}

/** A label row that wraps its control, so the row is the target and the label its name. */
export function ControlRow({
  control,
  label,
  description,
}: {
  control: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm max-sm:min-h-11 max-sm:items-center">
      <span className="flex h-5 items-center">{control}</span>
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}
