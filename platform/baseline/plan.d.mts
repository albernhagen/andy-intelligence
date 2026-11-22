// Types for plan.mjs, so the API's TypeScript can import it (AI-113).
import type { Rendered, RenderedFile } from "./files.mjs";
import type { SectionResult } from "./github.mjs";

export const HELD_BY_APP: RegExp;
export const RECORD_PATH: string;
export const MAX_SETTING_LINES: number;
export interface ReportEntry {
  path: string;
  note: string;
}
export interface BaselinePlan {
  files: RenderedFile[];
  applied: ReportEntry[];
  differs: ReportEntry[];
  skipped: ReportEntry[];
  held: ReportEntry[];
}
export function planBaselinePr(
  rendered: Rendered,
  target: Map<string, string | null>,
  opts: { source: string; sha: string; ref: string; date: string },
): BaselinePlan;
export function heldToAdd(rendered: Rendered, exists: (path: string) => boolean): RenderedFile[];
export function pathsToRead(rendered: Rendered): string[];
export function renderReport(r: {
  repo: string;
  source: string;
  sha: string;
  ref: string;
  branch: string;
  plan: BaselinePlan;
  settings: { results: SectionResult[] } | { error: string };
}): string;
