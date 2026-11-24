import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A placeholder in the shape of the content that is loading (AI-369). Static on purpose: a pulse
 * would be motion longer than 180 ms that explains nothing (design.md "Motion").
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn("rounded-md bg-muted", className)}
      {...props}
    />
  );
}
