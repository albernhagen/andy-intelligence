import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The bar atop a page (AI-378, direction A): the title, then the page's view controls (tabs,
 * segmented windows), then its actions at the end. Full width with a border below; it cancels
 * the shell's `main` padding so the border meets both edges.
 */
export function PageHeader({
  title,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  /** View controls beside the title. */
  children?: ReactNode;
  /** Actions or a summary at the end of the bar. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "-mx-4 -mt-4 mb-4 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2 sm:-mx-6 sm:px-6",
        className,
      )}
    >
      <h2 className="text-md font-semibold">{title}</h2>
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
