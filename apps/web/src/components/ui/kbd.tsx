import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A key hint on the control it triggers (AI-369): `<Button aria-keyshortcuts="Z">Undo <Kbd>Z</Kbd></Button>`.
 * Hidden from screen readers so the control's name stays its verb; the control's
 * `aria-keyshortcuts` announces the key instead.
 */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-current/30 px-1 font-mono text-2xs leading-none opacity-80",
        className,
      )}
      {...props}
    />
  );
}
