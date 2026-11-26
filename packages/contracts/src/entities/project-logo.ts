import { z } from "zod";
import { Timestamp } from "./common";

/**
 * A project's logo (AI-393). Uploaded files are untrusted: an SVG is stored only after the API
 * rebuilt it from an allowlist (no scripts, handlers or external references), a PNG only after
 * its signature checked out. The web shows it through `<img>` (a data URL), never inline.
 */

/** Size caps (ADR-0028), on the decoded file. */
export const LOGO_LIMITS = { svgBytes: 64 * 1024, pngBytes: 128 * 1024 } as const;

/** The longest `data`: a PNG at its cap, base64 (4 characters per 3 bytes). */
export const LOGO_DATA_MAX = Math.ceil(LOGO_LIMITS.pngBytes / 3) * 4;

export const LogoFormat = z.enum(["svg", "png"]);
export type LogoFormat = z.infer<typeof LogoFormat>;

/** An upload: SVG markup as text, or a PNG as base64. */
export const SetProjectLogo = z.strictObject({
  format: LogoFormat.describe("svg (markup as text) or png (base64)."),
  data: z
    .string()
    .min(1)
    .max(LOGO_DATA_MAX)
    .describe(
      `The file: SVG markup (at most ${LOGO_LIMITS.svgBytes / 1024} KB; no scripts, event handlers or external references; CSS without @import or external url()) or a PNG as base64 (at most ${LOGO_LIMITS.pngBytes / 1024} KB decoded).`,
    ),
});
export type SetProjectLogo = z.infer<typeof SetProjectLogo>;

/** The stored logo, one per project. `data` is already sanitized (SVG) or checked (PNG). */
export const ProjectLogo = z.object({
  projectId: z.string().min(1),
  format: LogoFormat,
  data: z.string().min(1).max(LOGO_DATA_MAX),
  updatedAt: Timestamp,
  /** The actor who stored it, `user:<uid>`. */
  updatedBy: z.string().min(1).max(320),
});
export type ProjectLogo = z.infer<typeof ProjectLogo>;

/** What the API and MCP return: the logo, or null while the project shows its default mark. */
export const ProjectLogoView = z.object({
  logo: ProjectLogo.pick({ format: true, data: true, updatedAt: true }).nullable(),
});
export type ProjectLogoView = z.infer<typeof ProjectLogoView>;
