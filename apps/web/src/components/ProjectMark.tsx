import type { Project } from "@andy/contracts";
import { useProjectLogo } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * A project's mark (AI-393): its logo, or, while it has none (or the logo is still loading or
 * failed), the default: its key on a tile. The logo is always an `<img>` from a data URL, never
 * inline markup, so a stored SVG can run no script and load nothing (the API sanitized it too).
 */
export function ProjectMark({
  project,
  className,
}: {
  project: Pick<Project, "id" | "key" | "logoUpdatedAt">;
  className?: string;
}) {
  const logo = useProjectLogo(project.id, project.logoUpdatedAt ?? null).data?.logo;
  if (!logo) return <KeyTile projectKey={project.key} className={className} />;
  return (
    <img
      src={logoSrc(logo)}
      alt=""
      data-project-logo={project.key}
      className={cn("size-5 shrink-0 rounded object-contain", className)}
    />
  );
}

/** The default mark: the project's key on a tile, in the theme's foreground colour. */
export function KeyTile({ projectKey, className }: { projectKey: string; className?: string }) {
  return (
    <span
      data-project-key-tile
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-foreground px-1 text-2xs font-semibold text-background",
        className,
      )}
    >
      {projectKey}
    </span>
  );
}

/** The `<img>` source for a stored logo: an SVG as UTF-8 text, a PNG as base64. */
export function logoSrc(logo: { format: "svg" | "png"; data: string }): string {
  return logo.format === "svg"
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logo.data)}`
    : `data:image/png;base64,${logo.data}`;
}
