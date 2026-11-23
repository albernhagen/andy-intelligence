// Types for github.mjs, so the API's TypeScript can import it (AI-113).
export type Gh = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; data: unknown }> | { status: number; data: unknown };
export interface SettingDiff {
  setting: string;
  want: unknown;
  have: unknown;
}
export interface SectionResult {
  section: string;
  status: "ok" | "drift" | "unreadable";
  diffs: SettingDiff[];
  error?: string;
  live?: unknown;
}
export type BaselineConfig = Record<string, unknown>;
export const UNREADABLE: string;
export const SECTIONS: { name: string }[];
export const CONFIG_FILES: string[];
export function parseConfig(read: (name: string) => string): BaselineConfig;
export function configFor(config: BaselineConfig, repo: string, source: string): BaselineConfig;
export function checkSections(
  gh: Gh,
  repo: string,
  config: BaselineConfig,
  names: string[],
): Promise<SectionResult[]>;
