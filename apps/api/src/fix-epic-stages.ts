import { fileURLToPath } from "node:url";
import { epicStageFixes, syncEpicStage } from "@andy/domain";

/**
 * One-off fix-up (AI-404, ADR-0164): sets every epic of a project to the stage its tickets give
 * it, child epics first. Idempotent: a second run finds nothing to do. Dry run by default: one
 * line per epic it would move. Runbook: docs/runbooks/epic-state-fixup.md.
 *
 *   GOOGLE_CLOUD_PROJECT=<control-plane project> \
 *     pnpm --filter @andy/api exec tsx src/fix-epic-stages.ts --project ai [--apply]
 *
 * Reads the project's tickets once; with `--apply`, each epic is re-read with its children and
 * written as `system` with the reason "follows its tickets: N of M done" (its history entry).
 * Writes with Application Default Credentials to the Firestore of GOOGLE_CLOUD_PROJECT.
 */

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args: string[]) {
  const projectId = arg(args, "project");
  const apply = args.includes("--apply");
  if (!projectId) throw new Error("usage: --project <id> [--apply]");
  const gcpProject = process.env.GOOGLE_CLOUD_PROJECT;
  if (!gcpProject) throw new Error("set GOOGLE_CLOUD_PROJECT to the control plane's GCP project");
  // Loaded here so the module imports without GCP clients (type checks).
  const { FirestoreWorkTracker, createFirestore } = await import("@andy/store");
  const tracker = new FirestoreWorkTracker(createFirestore(gcpProject));
  if (!(await tracker.getProject(projectId))) throw new Error(`project ${projectId} not found`);

  const fixes = epicStageFixes(await tracker.listTickets(projectId));
  for (const f of fixes) console.log(`${f.key}: ${f.title} · ${f.from} → ${f.to} · ${f.reason}`);
  if (!apply) {
    console.log(`Dry run: ${fixes.length} epics to move. Re-run with --apply to write them.`);
    return;
  }
  let written = 0;
  for (const f of fixes) {
    if (await syncEpicStage(tracker, projectId, f.id)) written++;
  }
  console.log(`Moved ${written} epics; ${fixes.length - written} were already in step.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
