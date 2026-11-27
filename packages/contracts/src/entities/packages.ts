import { z } from "zod";

/**
 * Packages a plan names for the build (AI-386, ADR-0156). Untrusted agent output: every field
 * capped (ADR-0028), and shaped so the trusted install step can only reach the registry.
 */
export const PACKAGE_LIMITS = {
  /** Packages one ticket's plan may name. */
  maxPackages: 5,
  /** npm's own limit on a package name. */
  name: 214,
  workspace: 300,
  why: 500,
} as const;

/**
 * An npm package name, nothing else (AI-386): no version, range, tag, URL, `git:`, `file:` or
 * `npm:` alias, so the trusted install step picks the version (its 7-day cooldown) and a plan
 * can't point it at anything but the registry. Lowercase, optionally scoped.
 */
export const PackageName = z
  .string()
  .max(PACKAGE_LIMITS.name)
  .regex(/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, "an npm package name, no version");

/**
 * Where a package goes: a repo-relative directory holding a `package.json`, `.` for the root.
 * No `..`, no absolute path, no leading `./`, no trailing slash.
 */
export const PackageWorkspace = z
  .string()
  .max(PACKAGE_LIMITS.workspace)
  .regex(
    /^(\.|[A-Za-z0-9_@][A-Za-z0-9._@-]*(\/[A-Za-z0-9_@][A-Za-z0-9._@-]*)*)$/,
    "a repo-relative directory, or . for the root",
  )
  .refine((w) => !w.split("/").includes(".."), "no .. segments");

/**
 * A package the plan needs installed before the build (AI-386, ADR-0156). Andy sees it when he
 * approves the plan; a trusted step outside the sandbox installs it with install scripts off.
 */
export const PlanPackage = z.strictObject({
  name: PackageName,
  kind: z.enum(["runtime", "dev"]),
  workspace: PackageWorkspace,
  why: z.string().trim().min(1).max(PACKAGE_LIMITS.why),
});
export type PlanPackage = z.infer<typeof PlanPackage>;

export const PlanPackages = z
  .array(PlanPackage)
  .max(PACKAGE_LIMITS.maxPackages)
  .refine((ps) => new Set(ps.map((p) => p.name)).size === ps.length, "each package once");
