// Types for files.mjs, so the API's TypeScript can import it (AI-113).
export type DeployKind = "none" | "cloud-run";
export const DEPLOY_KINDS: DeployKind[];
export function checkDeployKind(kind: unknown): DeployKind;
export type Environments = "prod-only" | "dev-and-prod";
export const ENVIRONMENTS: Environments[];
export function checkEnvironments(value: unknown): Environments;
interface ManifestEntry {
  path: string;
  from: string;
  pin?: boolean;
  deployKind?: DeployKind;
  environments?: Environments;
  group?: string;
}
export interface Manifest {
  source: string;
  managed: ManifestEntry[];
  lines: ManifestEntry[];
  seed: ManifestEntry[];
  starter: ManifestEntry[];
}
export interface RenderedFile {
  path: string;
  content: string;
  /** Seed group: written only all together (AI-109). */
  group?: string;
}
export interface Rendered {
  managed: RenderedFile[];
  lines: { path: string; lines: string[] }[];
  seed: RenderedFile[];
  starter: RenderedFile[];
}
export function renderFiles(
  manifest: Manifest,
  read: (from: string) => string,
  pin: { sha: string; ref: string; deployKind?: DeployKind; environments?: Environments },
): Rendered;
export function mergeLines(existing: string | null | undefined, required: string[]): string;
export function baselineRecord(r: {
  source: string;
  sha: string;
  ref: string;
  date: string;
  deployKind?: DeployKind;
}): string;
export function deployFlags(p: { deployKind?: DeployKind; environments?: Environments }): string;
