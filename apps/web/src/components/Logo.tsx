import { LOGO_PEAK, LOGO_VIEWBOX, LOGO_WAVE } from "@/lib/logo";
import { cn } from "@/lib/utils";

/**
 * The mark (AI-392). The summit takes the surrounding text colour (`currentColor`), the wave the
 * `primary` token, so both follow the theme. Decorative unless `label` is given. Clear space: a
 * quarter of its size on every side (`design.md`, Logo).
 */
export function LogoMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      className={cn("size-5 shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-logo
    >
      <path
        d={LOGO_PEAK.d}
        fill="none"
        stroke="currentColor"
        strokeWidth={LOGO_PEAK.strokeWidth}
        strokeLinejoin="miter"
      />
      <path
        d={LOGO_WAVE.d}
        fill="none"
        className="stroke-primary"
        strokeWidth={LOGO_WAVE.strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark beside the product name: the sidebar's top row and the sign-in header. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      <LogoMark />
      andy-intelligence
    </span>
  );
}
