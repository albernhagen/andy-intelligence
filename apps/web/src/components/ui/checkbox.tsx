import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ControlRow } from "./switch";

/**
 * shadcn/ui Checkbox on Radix (AI-368): one of several independent choices, or a choice saved with
 * a form. Never a native checkbox. With `label`, the row is the target (44 px on a phone).
 */
export function Checkbox({
  className,
  label,
  description,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  label?: React.ReactNode;
  description?: React.ReactNode;
}) {
  const control = (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-sm border border-border bg-raised text-primary-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === "indeterminate" ? (
          <Minus className="size-3" aria-hidden />
        ) : (
          <Check className="size-3" aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return control;
  return <ControlRow control={control} label={label} description={description} />;
}
