import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Project, ReleaseNote, ReleaseNoteStore, Ticket } from "@andy/contracts";
import { buildReleaseNote, firstSentence, ticketKeyFor } from "@andy/domain";

/**
 * One-off backfill (AI-159): release notes for PRs merged before the block existed, so What's new
 * is useful on day one. "What changed" is each PR's block when it has one, else its summary's
 * first sentence; every note is marked `backfill`. Never overwrites a stored note (`create`).
 * Dry run by default: prints one line per note. Runbook: docs/runbooks/whats-new-backfill.md.
 *
 *   pnpm --filter @andy/api exec tsx src/backfill-release-notes.ts --project ai \
 *     --repo albernhagen/andy-intelligence --since 2026-11-10 [--apply]
 *
 * Reads PRs with the `gh` CLI (your login); writes with Application Default Credentials to the
 * Firestore of GOOGLE_CLOUD_PROJECT. PR text is untrusted: it is only parsed, capped and stored.
 */

/** At most this many PRs per run (ADR-0028). */
export const BACKFILL_MAX_PRS = 300;

/** The fields `gh pr list --json` returns for one PR. */
export interface MergedPr {
  number: number;
  title: string;
  body: string;
  url: string;
  mergedAt: string;
  mergedBy: { login: string } | null;
  headRefName: string;
  files?: { path: string }[];
}

/** Builds the notes; pure, so the dry run and the tests see exactly what `--apply` writes. */
export function backfillNotes(
  prs: readonly MergedPr[],
  project: Pick<Project, "id" | "key">,
  tickets: readonly Pick<Ticket, "key" | "title" | "risk">[],
  now: Date,
): ReleaseNote[] {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  return prs.slice(0, BACKFILL_MAX_PRS).map((pr) => {
    const body = pr.body ?? "";
    const key = ticketKeyFor(project.key, {
      headRef: pr.headRefName,
      bodyFirstLine: body.split(/\r?\n/, 1)[0]?.trim().slice(0, 256) ?? "",
    });
    return buildReleaseNote({
      projectId: project.id,
      pr: { number: pr.number, url: pr.url, title: pr.title },
      details: {
        body: body.slice(0, 20_000),
        mergedBy: pr.mergedBy?.login ?? null,
        mergedAt: pr.mergedAt,
      },
      ticket: key ? (byKey.get(key) ?? null) : null,
      files: pr.files ?? [],
      recordedAt: now.toISOString(),
      fallback: { source: "backfill", whatChanged: firstSentence(body) || pr.title },
    });
  });
}

/** Writes each note unless the PR already has one. */
export async function applyBackfill(store: ReleaseNoteStore, notes: readonly ReleaseNote[]) {
  const counts = { created: 0, exists: 0 };
  for (const note of notes) counts[await store.create(note)]++;
  return counts;
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args: string[]) {
  const projectId = arg(args, "project");
  const repo = arg(args, "repo");
  const since = arg(args, "since");
  const apply = args.includes("--apply");
  if (!projectId || !repo || !since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error("usage: --project <id> --repo <owner/name> --since YYYY-MM-DD [--apply]");
  }
  const gcpProject = process.env.GOOGLE_CLOUD_PROJECT;
  if (!gcpProject) throw new Error("set GOOGLE_CLOUD_PROJECT to the control plane's GCP project");
  // Loaded here so the pure functions above import without GCP clients (tests, type checks).
  const { FirestoreReleaseNoteStore, FirestoreWorkTracker, createFirestore } =
    await import("@andy/store");
  const db = createFirestore(gcpProject);
  const tracker = new FirestoreWorkTracker(db);
  const project = await tracker.getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const tickets = await tracker.listTickets(projectId);

  const json = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "merged",
      "--search",
      `merged:>=${since} base:main`,
      "--limit",
      String(BACKFILL_MAX_PRS),
      "--json",
      "number,title,body,url,mergedAt,mergedBy,headRefName,files",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const notes = backfillNotes(JSON.parse(json) as MergedPr[], project, tickets, new Date());
  for (const n of notes) {
    console.log(`PR #${n.prNumber} · ${n.ticketKey ?? "no ticket"} · ${n.whatChanged}`);
  }
  if (!apply) {
    console.log(`Dry run: ${notes.length} notes. Re-run with --apply to write them.`);
    return;
  }
  const counts = await applyBackfill(new FirestoreReleaseNoteStore(db), notes);
  console.log(`Wrote ${counts.created}; skipped ${counts.exists} PRs that already had a note.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
