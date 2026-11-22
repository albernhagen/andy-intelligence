// Project baseline as one pull request from the App (AI-113, ADR-0031, ADR-0038). Pure: what to
// write into a registered repo and the report of what was applied, what differs and what was
// skipped. The App never overwrites a file, never writes workflows or agent settings, and never
// changes GitHub settings; the report says what Andy runs for those.
import { baselineRecord, mergeLines, normalizePins } from "./files.mjs";

/**
 * Paths the App never writes: workflows (it has no `workflows` permission, and Andy won't grant
 * it) and agent settings (the same rule as single-file proposals). `finish` adds them.
 */
export const HELD_BY_APP = /^\.(github\/workflows|claude)(\/|$)/i;

export const RECORD_PATH = ".andy/baseline.json";

/** At most this many settings differences in the report; the rest are counted (ADR-0028). */
export const MAX_SETTING_LINES = 30;

const sameManaged = (want, have, source) =>
  normalizePins(want, source).text === normalizePins(have, source).text;

/**
 * Plans the baseline PR. `rendered` is `renderFiles(...)`; `target` maps each path the plan
 * asks about to the repo's text or null (missing). Returns { files, applied, differs, skipped,
 * held }: files to commit ({ path, content }), and report entries ({ path, note }).
 */
export function planBaselinePr(rendered, target, { source, sha, ref, date }) {
  const read = (p) => target.get(p) ?? null;
  const files = [];
  const applied = [];
  const differs = [];
  const skipped = [];
  const held = [];

  for (const f of rendered.managed) {
    const have = read(f.path);
    if (HELD_BY_APP.test(f.path)) {
      if (have === null) held.push({ path: f.path, note: "missing" });
      else if (!sameManaged(f.content, have, source))
        held.push({ path: f.path, note: "differs from the baseline; left unchanged" });
      continue;
    }
    if (have === null) {
      files.push({ path: f.path, content: f.content });
      applied.push({ path: f.path, note: "added" });
    } else if (!sameManaged(f.content, have, source)) {
      differs.push({ path: f.path, note: "differs from the baseline; left unchanged" });
    }
  }

  for (const f of rendered.lines) {
    const have = read(f.path);
    const merged = mergeLines(have, f.lines);
    if (merged !== (have ?? "")) {
      files.push({ path: f.path, content: merged });
      applied.push({
        path: f.path,
        note: have === null ? "added" : "missing baseline lines appended",
      });
    }
  }

  for (const f of rendered.seed) {
    if (read(f.path) === null) {
      files.push({ path: f.path, content: f.content });
      applied.push({ path: f.path, note: "added (seed: the project's own from now on)" });
    } else {
      skipped.push({ path: f.path, note: "already there (seed: the project's own)" });
    }
  }

  // The starter needs `pnpm install` for its lockfile, which the App can't run.
  if (read("package.json") === null) {
    for (const f of rendered.starter) {
      skipped.push({ path: f.path, note: "starter file: needs `pnpm install`; run `files`" });
    }
  }

  const record = read(RECORD_PATH);
  if (record === null) {
    files.push({ path: RECORD_PATH, content: baselineRecord({ source, sha, ref, date }) });
    applied.push({ path: RECORD_PATH, note: `added (baseline ${sha.slice(0, 7)})` });
  } else {
    let version = null;
    try {
      version = JSON.parse(record).version ?? null;
    } catch {
      // A record that isn't JSON is reported as differing, like any other.
    }
    if (version !== sha) {
      differs.push({ path: RECORD_PATH, note: "records another baseline; left unchanged" });
    }
  }

  return { files, applied, differs, skipped, held };
}

/**
 * The files `finish` adds to the App's PR branch: held ones (`HELD_BY_APP`) the branch doesn't
 * have. `exists(path)` says whether the branch has it; an existing one, even if it differs, is
 * never overwritten.
 */
export function heldToAdd(rendered, exists) {
  return rendered.managed.filter((f) => HELD_BY_APP.test(f.path) && !exists(f.path));
}

/** Every path `planBaselinePr` reads from the target repo. */
export function pathsToRead(rendered) {
  return [
    ...rendered.managed.map((f) => f.path),
    ...rendered.lines.map((f) => f.path),
    ...rendered.seed.map((f) => f.path),
    "package.json",
    RECORD_PATH,
  ];
}

/**
 * A value for one report line, as an inline code span: JSON, backticks and newlines removed, at
 * most 120 characters. Values come from the target repo, so markdown, links and @mentions in
 * them must not render (they are data, never instructions).
 */
function show(value) {
  const raw = (JSON.stringify(value) ?? String(value)).replace(/[`\r\n]/g, "'");
  const text = raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
  return `\`${text}\``;
}

const list = (entries) => entries.map((e) => `- \`${e.path}\`: ${e.note}`).join("\n");

/** The settings part of the report: each section's status and its differences, capped. */
function settingsReport(settings, repo) {
  const apply = [
    "",
    "The App doesn't change GitHub settings. To see and apply them, from an andy-intelligence checkout:",
    "",
    "```bash",
    `node platform/baseline/baseline.mjs apply ${repo} --dry-run`,
    `node platform/baseline/baseline.mjs apply ${repo}`,
    "```",
  ];
  if (settings.error) {
    return [`Couldn't read them: ${show(settings.error)}.`, ...apply].join("\n");
  }
  const lines = [];
  let shown = 0;
  let hidden = 0;
  for (const r of settings.results) {
    const what =
      r.status === "ok"
        ? "matches"
        : r.status === "drift"
          ? "differs; left unchanged"
          : r.error && !/HTTP 40[13]/.test(r.error)
            ? `couldn't read: ${show(r.error)}`
            : "couldn't read (the App has no administration permission)";
    lines.push(`- ${r.section}: ${what}`);
    for (const d of r.status === "drift" ? r.diffs : []) {
      if (shown >= MAX_SETTING_LINES) {
        hidden++;
        continue;
      }
      shown++;
      lines.push(`  - \`${d.setting || "(whole)"}\`: want ${show(d.want)}, have ${show(d.have)}`);
    }
  }
  if (hidden > 0) lines.push(`- and ${hidden} more differences: run \`apply --dry-run\``);
  return [...lines, ...apply].join("\n");
}

/** Markdown for the PR description: what was applied, differs, was skipped or left out. */
export function renderReport({ repo, source, sha, ref, branch, plan, settings }) {
  const section = (title, entries, empty) =>
    `### ${title} (${entries.length})\n\n${entries.length ? list(entries) : empty}`;
  const parts = [
    "## Project baseline",
    `From \`${source}\` at \`${sha.slice(0, 7)}\` (\`${ref}\`), opened by the andy-intelligence App when this repo was registered (AI-113). Nothing that was already here is overwritten.`,
    section("Applied", plan.applied, "Nothing: every file the App may write is already here."),
    section("Differs: left unchanged", plan.differs, "Nothing."),
    section("Skipped", plan.skipped, "Nothing."),
    `### Left out for you to add (${plan.held.length})\n\n${
      plan.held.length === 0
        ? "Nothing."
        : [
            "The App can't write workflows or agent settings. From an up-to-date andy-intelligence checkout, this commits the missing ones to this PR's branch:",
            "",
            "```bash",
            `node platform/baseline/baseline.mjs finish ${repo} --ref ${sha} --branch ${branch}`,
            "```",
            "",
            list(plan.held),
          ].join("\n")
    }`,
    `### GitHub settings: report only\n\n${settingsReport(settings, repo)}`,
  ];
  return `${parts.join("\n\n")}\n`;
}
