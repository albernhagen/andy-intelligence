// Types for files.mjs, so the API's TypeScript can import it (AI-113).
export interface Manifest {
  source: string;
  managed: { path: string; from: string; pin?: boolean }[];
  lines: { path: string; from: string }[];
  seed: { path: string; from: string }[];
  starter: { path: string; from: string }[];
}
export interface RenderedFile {
  path: string;
  content: string;
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
  pin: { sha: string; ref: string },
): Rendered;
export function mergeLines(existing: string | null | undefined, required: string[]): string;
export function baselineRecord(r: {
  source: string;
  sha: string;
  ref: string;
  date: string;
}): string;
