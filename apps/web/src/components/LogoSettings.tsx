import { useId, useRef, useState } from "react";
import { LOGO_LIMITS, type Project } from "@andy/contracts";
import { KeyTile, logoSrc } from "@/components/ProjectMark";
import { SaveError, SettingHeading } from "@/components/SettingRow";
import { Button } from "@/components/ui/button";
import { useProjectLogo, useRemoveProjectLogo, useSetProjectLogo } from "@/lib/queries";

/**
 * Settings → Logo (AI-393): a preview, Upload (SVG or PNG) and Remove. The browser checks type
 * and size first only to answer fast; the API is the check that counts (sanitizer, signature,
 * caps) and its refusal shows under the control. MCP: `set_project_logo`, `remove_project_logo`.
 */
export function LogoSettings({ project }: { project: Project }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const logo = useProjectLogo(project.id, project.logoUpdatedAt).data?.logo ?? null;
  const set = useSetProjectLogo(project.id);
  const remove = useRemoveProjectLogo(project.id);
  const [local, setLocal] = useState<string | null>(null);
  const busy = set.isPending || remove.isPending;
  const state = {
    isPending: busy,
    isSuccess: set.isSuccess || remove.isSuccess,
    error: local ?? set.error ?? remove.error,
  };

  const upload = async (file: File) => {
    setLocal(null);
    set.reset();
    remove.reset();
    const read = await readLogo(file);
    if ("refused" in read) setLocal(read.refused);
    else set.mutate(read);
  };

  return (
    <section aria-label="Logo" className="space-y-3 py-2.5">
      <SettingHeading
        label="Logo"
        htmlFor={id}
        description={`Shown wherever ${project.name} is named. SVG up to ${LOGO_LIMITS.svgBytes / 1024} KB (no scripts or links to other files) or PNG up to ${LOGO_LIMITS.pngBytes / 1024} KB. With none, the project's key shows.`}
        state={state}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-16 items-center justify-center rounded-md border border-border bg-raised">
          {logo ? (
            <img
              src={logoSrc(logo)}
              alt={`${project.name} logo`}
              className="size-12 object-contain"
            />
          ) : (
            <KeyTile projectKey={project.key} className="h-8 min-w-8 text-xs" />
          )}
        </div>
        <input
          ref={input}
          id={id}
          type="file"
          accept=".svg,.png,image/svg+xml,image/png"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button
          variant="outline"
          className="h-11 sm:h-9"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {logo ? "Replace" : "Upload"}
        </Button>
        {logo && (
          <Button
            variant="ghost"
            className="h-11 sm:h-9"
            disabled={busy}
            onClick={() => {
              setLocal(null);
              set.reset();
              remove.mutate();
            }}
          >
            Remove
          </Button>
        )}
      </div>
      <SaveError state={state} />
    </section>
  );
}

/** The upload body for a picked file, or why the browser already refuses it. */
export async function readLogo(
  file: File,
): Promise<{ format: "svg" | "png"; data: string } | { refused: string }> {
  const name = file.name.toLowerCase();
  if (file.type === "image/svg+xml" || name.endsWith(".svg")) {
    if (file.size > LOGO_LIMITS.svgBytes) {
      return { refused: `the SVG is over ${LOGO_LIMITS.svgBytes / 1024} KB` };
    }
    return { format: "svg", data: await file.text() };
  }
  if (file.type === "image/png" || name.endsWith(".png")) {
    if (file.size > LOGO_LIMITS.pngBytes) {
      return { refused: `the PNG is over ${LOGO_LIMITS.pngBytes / 1024} KB` };
    }
    return { format: "png", data: toBase64(new Uint8Array(await file.arrayBuffer())) };
  }
  return { refused: "only SVG and PNG files can be a logo" };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
