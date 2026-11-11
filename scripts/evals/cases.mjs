// Eval cases (AI-6, ADR-0086): plain JSON data with a fixed check vocabulary, read from one git
// commit without checking it out. A case never carries code: the checks live in assertions.mjs.
import { execFileSync } from "node:child_process";
import { AGENTS, MAX_CASE_BYTES, MAX_CASES, MAX_INPUT_BYTES, SEVERITIES } from "./config.mjs";

export const EVALS_ROOT = "platform/evals";
const BASELINES_FILE = "baselines.json";

const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const CASE_FILE = /^[a-z0-9][a-z0-9-]{0,59}\.json$/;
const INPUT = /^inputs\/[a-z0-9][a-z0-9._-]{0,100}$/;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$/;
const MAX_FILES = 10;
const MAX_CHECKS = 10;
const MAX_MENTIONS = 10;

/**
 * The env without inherited GIT_* variables (a git hook sets GIT_DIR, GIT_INDEX_FILE …), so
 * `git -C repo` always means that repo.
 */
export function cleanGitEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_")));
}

/**
 * Files at one commit of `repo`. Symlinks and non-files are refused, so a case can't point the
 * runner at a file outside the tree. Paths are literal (no pathspec magic).
 */
export function gitTree(repo, ref) {
  const git = (args) =>
    execFileSync("git", ["-C", repo, ...args], {
      env: { ...cleanGitEnv(process.env), GIT_LITERAL_PATHSPECS: "1" },
      maxBuffer: 32 * 1024 * 1024,
    });
  const ls = (path) =>
    git(["ls-tree", "-r", "-z", "--full-tree", ref, "--", path])
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const [meta, file] = line.split("\t");
        const [mode, type] = meta.split(" ");
        return { path: file, mode, type };
      });
  return {
    /** Paths of regular files directly inside `dir`. */
    files(dir) {
      return ls(dir)
        .filter((e) => e.path.startsWith(`${dir}/`) && !e.path.slice(dir.length + 1).includes("/"))
        .filter((e) => e.type === "blob" && e.mode !== "120000")
        .map((e) => e.path);
    },
    /** The text of one regular file, or an error naming the path. */
    read(path, maxBytes = MAX_INPUT_BYTES) {
      const entry = ls(path).find((e) => e.path === path);
      if (!entry) throw new Error(`${path}: not found at ${ref}`);
      if (entry.type !== "blob" || entry.mode === "120000") {
        throw new Error(`${path}: not a regular file (symlinks are refused)`);
      }
      const size = Number(
        git(["cat-file", "-s", `${ref}:${path}`])
          .toString()
          .trim(),
      );
      if (size > maxBytes) throw new Error(`${path}: ${size} bytes, over the ${maxBytes} cap`);
      return git(["cat-file", "blob", `${ref}:${path}`]).toString("utf8");
    },
  };
}

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

function onlyKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj))
    if (!allowed.includes(k)) errors.push(`${where}: unknown key "${k}"`);
}

function severities(value, agent, where, errors) {
  const known = SEVERITIES[agent] ?? [];
  if (!Array.isArray(value) || value.length === 0 || !value.every((s) => known.includes(s))) {
    errors.push(`${where}: severity must be a non-empty list of ${known.join(", ")}`);
  }
}

function validateCheck(check, agent, where, errors) {
  if (!isObj(check)) return errors.push(`${where}: must be an object`);
  switch (check.check) {
    case "finding":
      onlyKeys(check, ["check", "severity", "file", "mentions"], where, errors);
      severities(check.severity, agent, where, errors);
      if (check.file !== undefined && !isStr(check.file, 200)) errors.push(`${where}: bad file`);
      if (
        check.mentions !== undefined &&
        !(
          Array.isArray(check.mentions) &&
          check.mentions.length > 0 &&
          check.mentions.length <= MAX_MENTIONS &&
          check.mentions.every((m) => isStr(m, 80))
        )
      ) {
        errors.push(`${where}: mentions must be 1-${MAX_MENTIONS} short strings`);
      }
      return;
    case "no-finding":
      onlyKeys(check, ["check", "severity"], where, errors);
      severities(check.severity, agent, where, errors);
      return;
    case "max-findings":
      onlyKeys(check, ["check", "max", "severity"], where, errors);
      if (!Number.isInteger(check.max) || check.max < 0 || check.max > 50) {
        errors.push(`${where}: max must be an integer 0-50`);
      }
      if (check.severity !== undefined) severities(check.severity, agent, where, errors);
      return;
    default:
      errors.push(`${where}: check must be finding, no-finding or max-findings`);
  }
}

/** The case's problems, as messages naming fields only (never values from the file). */
export function validateCase(raw, file) {
  const errors = [];
  if (!isObj(raw)) return [`${file}: must be a JSON object`];
  onlyKeys(raw, ["id", "agent", "source", "inputs", "files", "expect", "stubOutput"], file, errors);
  if (typeof raw.id !== "string" || !ID.test(raw.id)) errors.push(`${file}: id must match ${ID}`);
  else if (`${raw.id}.json` !== file.split("/").pop())
    errors.push(`${file}: id must match file name`);
  if (!Object.hasOwn(AGENTS, raw.agent)) {
    errors.push(`${file}: agent must be one of ${Object.keys(AGENTS).join(", ")}`);
  }
  if (!isStr(raw.source, 200)) errors.push(`${file}: source must say where the case came from`);
  if (!isObj(raw.inputs)) errors.push(`${file}: inputs must be an object`);
  else {
    onlyKeys(raw.inputs, ["diff", "discussion"], `${file} inputs`, errors);
    if (typeof raw.inputs.diff !== "string" || !INPUT.test(raw.inputs.diff)) {
      errors.push(`${file}: inputs.diff must match ${INPUT}`);
    }
    if (raw.inputs.discussion !== undefined && !INPUT.test(String(raw.inputs.discussion))) {
      errors.push(`${file}: inputs.discussion must match ${INPUT}`);
    }
  }
  if (raw.files !== undefined) {
    if (!isObj(raw.files) || Object.keys(raw.files).length > MAX_FILES) {
      errors.push(`${file}: files must map at most ${MAX_FILES} workspace paths to inputs`);
    } else {
      for (const [to, from] of Object.entries(raw.files)) {
        if (!to.split("/").every((s) => SEGMENT.test(s))) {
          errors.push(`${file}: files key must be a relative path without dot segments`);
        }
        if (typeof from !== "string" || !INPUT.test(from)) {
          errors.push(`${file}: files values must match ${INPUT}`);
        }
      }
    }
  }
  if (!Array.isArray(raw.expect) || raw.expect.length === 0 || raw.expect.length > MAX_CHECKS) {
    errors.push(`${file}: expect must hold 1-${MAX_CHECKS} checks`);
  } else {
    raw.expect.forEach((c, i) => validateCheck(c, raw.agent, `${file} expect[${i}]`, errors));
  }
  if (!isObj(raw.stubOutput)) errors.push(`${file}: stubOutput must be an object`);
  return errors;
}

/** `{ live: { caseId: tokens }, stub: { … } }`; a missing file is no baselines. */
export function parseBaselines(text, file) {
  const raw = JSON.parse(text);
  const out = { live: {}, stub: {} };
  for (const key of ["live", "stub"]) {
    const map = raw?.[key] ?? {};
    if (!isObj(map)) throw new Error(`${file}: ${key} must be an object`);
    for (const [id, n] of Object.entries(map)) {
      if (!ID.test(id) || !Number.isInteger(n) || n <= 0) {
        throw new Error(`${file}: ${key} entries must be case id → positive integer`);
      }
      out[key][id] = n;
    }
  }
  return out;
}

/**
 * Every case in `dir` (or only `only`), validated, with its inputs read; plus the dir's
 * baselines. Throws one error listing every problem, and above MAX_CASES (ADR-0028).
 */
export function loadSuite(tree, dir, { only = [] } = {}) {
  const errors = [];
  // File names come from the PR: anything that isn't `<id>.json` is counted, never echoed, so a
  // name can't carry a workflow command or Markdown into the log or the summary.
  const named = tree.files(dir).map((f) => f.slice(dir.length + 1));
  const files = named.filter((n) => CASE_FILE.test(n)).map((n) => `${dir}/${n}`);
  const odd = named.filter((n) => !CASE_FILE.test(n) && n.endsWith(".json")).length;
  if (odd) errors.push(`${dir}: ${odd} .json file(s) not named <case id>.json`);
  const caseFiles = files.filter((f) => !f.endsWith(`/${BASELINES_FILE}`));
  const selected = only.length
    ? caseFiles.filter((f) =>
        only.includes(
          f
            .split("/")
            .pop()
            .replace(/\.json$/, ""),
        ),
      )
    : caseFiles;
  for (const id of only) {
    if (!ID.test(id)) errors.push(`a selected case id doesn't match ${ID}`);
    else if (!caseFiles.some((f) => f.endsWith(`/${id}.json`)))
      errors.push(`case ${id}: not in ${dir}`);
  }
  if (selected.length > MAX_CASES) {
    throw new Error(
      `${selected.length} cases selected; the cap is ${MAX_CASES} per run (ADR-0028)`,
    );
  }
  const cases = [];
  for (const file of selected) {
    let raw;
    try {
      raw = JSON.parse(tree.read(file, MAX_CASE_BYTES));
    } catch (err) {
      errors.push(`${file}: ${err instanceof SyntaxError ? "not valid JSON" : err.message}`);
      continue;
    }
    const problems = validateCase(raw, file);
    if (problems.length) {
      errors.push(...problems);
      continue;
    }
    try {
      const read = (p) => tree.read(`${EVALS_ROOT}/${p}`);
      cases.push({
        ...raw,
        diff: read(raw.inputs.diff),
        discussion: raw.inputs.discussion ? read(raw.inputs.discussion) : null,
        fileContents: Object.fromEntries(
          Object.entries(raw.files ?? {}).map(([to, from]) => [to, read(from)]),
        ),
      });
    } catch (err) {
      errors.push(err.message);
    }
  }
  let baselines = { live: {}, stub: {} };
  const baselineFile = `${dir}/${BASELINES_FILE}`;
  if (files.includes(baselineFile)) {
    try {
      baselines = parseBaselines(tree.read(baselineFile, MAX_CASE_BYTES), baselineFile);
    } catch (err) {
      errors.push(err instanceof SyntaxError ? `${baselineFile}: not valid JSON` : err.message);
    }
  }
  if (errors.length) throw new Error(`Eval cases are invalid:\n- ${errors.join("\n- ")}`);
  return { cases, baselines };
}
