import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Select on Radix (AI-368): for six or more options. Fewer than six: `OptionCards`, so
 * every option shows its description (design.md "Form components"). Never a native `<select>`.
 */

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-raised px-3 text-base text-foreground sm:h-8 sm:text-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:opacity-50 data-[placeholder]:text-muted-foreground aria-[invalid=true]:border-destructive",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] animate-enter overflow-hidden rounded-lg border border-border bg-raised p-1 text-sm text-foreground shadow-md",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** One option; `description` is a second line that says what picking it does. */
export function SelectItem({
  className,
  children,
  description,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { description?: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-11 cursor-default items-center gap-2 rounded-sm py-1 pr-2 pl-7 outline-none select-none sm:min-h-8",
        "data-[highlighted]:bg-muted data-[state=checked]:bg-selected data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center" aria-hidden>
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-selected-edge" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="flex flex-col">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </SelectPrimitive.Item>
  );
}
