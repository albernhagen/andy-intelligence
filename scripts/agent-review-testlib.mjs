import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Test helpers for the composite actions in platform/actions/agent-review-*. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The `run: |` script of step `name` in a composite action's action.yml, dedented. */
export function runScript(actionDir, name) {
  const lines = readFileSync(join(actionDir, "action.yml"), "utf8").split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`no step "${name}" in ${actionDir}`);
  const run = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && !line.startsWith("        ")) break;
    body.push(line.slice(8));
  }
  return body.join("\n");
}
