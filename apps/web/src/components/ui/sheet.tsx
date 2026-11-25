import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { DialogCloseButton, DialogOverlay } from "./dialog";

export { DialogTitle as SheetTitle, DialogDescription as SheetDescription } from "./dialog";

/**
 * shadcn/ui Sheet (AI-369): a dialog fixed to one edge. Same focus trap and Esc as Dialog. On a
 * phone it fills the screen (design.md "Phone": panels open full-screen).
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const sheetVariants = cva(
  "fixed z-50 flex animate-enter flex-col gap-3 overflow-y-auto bg-raised p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground shadow-md max-sm:inset-0",
  {
    variants: {
      side: {
        right: "sm:inset-y-0 sm:right-0 sm:w-[28rem] sm:border-l sm:border-border",
        bottom: "sm:inset-x-0 sm:bottom-0 sm:max-h-[80vh] sm:border-t sm:border-border",
      },
    },
    defaultVariants: { side: "right" },
  },
);

export function SheetContent({
  className,
  side,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & VariantProps<typeof sheetVariants>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        <DialogCloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
