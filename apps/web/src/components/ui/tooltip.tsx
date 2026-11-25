import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Tooltip (AI-369). Opens on hover and on keyboard focus, closes on Esc. It only
 * repeats or explains: phones have no hover, so nothing may live only in a tooltip.
 */
export function Tooltip({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & { delayDuration?: number }) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root {...props} />
    </TooltipPrimitive.Provider>
  );
}

export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs animate-enter rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
