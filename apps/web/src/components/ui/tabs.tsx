import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Tabs on Radix (AI-368): views of one thing on one page. Arrow keys move between tabs.
 * The picked tab is the selected state (`bg-selected`), like `Segmented`; on a phone the list
 * scrolls in its own box, never the page.
 */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("relative flex gap-1 overflow-x-auto border-b border-border pb-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm text-muted-foreground sm:h-8",
        "hover:bg-foreground/5 hover:text-foreground disabled:opacity-50",
        // Inside the trigger: the list scrolls on a phone and would clip an outer ring.
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        "data-[state=active]:bg-selected data-[state=active]:font-medium data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        "pt-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}
