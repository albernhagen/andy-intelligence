import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
  {
    variants: {
      variant: {
        default: "bg-foreground/10",
        ok: "bg-primary text-primary-foreground",
        // Status markers (design.md): a 15% tint behind the role colour.
        attention: "bg-attention/15 text-attention",
        running: "bg-running/15 text-running",
        success: "bg-success/15 text-success",
        danger: "bg-destructive/15 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
